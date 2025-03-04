from datetime import datetime, timezone
from typing import Optional

import asyncpg
from asyncpg.pool import Pool
from email_validator import validate_email, EmailNotValidError
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from abrechnung.config import Config
from abrechnung.core.errors import (
    NotFoundError,
    InvalidCommand,
)
from abrechnung.core.service import (
    Service,
)
from abrechnung.domain.users import User, Session
from abrechnung.framework.database import Connection
from abrechnung.framework.decorators import with_db_transaction

ALGORITHM = "HS256"


class InvalidPassword(Exception):
    pass


class LoginFailed(Exception):
    pass


class TokenMetadata(BaseModel):
    user_id: int
    session_id: int


class UserService(Service):
    def __init__(
        self,
        db_pool: Pool,
        config: Config,
    ):
        super().__init__(db_pool=db_pool, config=config)

        self.enable_registration = self.cfg.registration.enabled
        self.allow_guest_users = self.cfg.registration.allow_guest_users
        self.valid_email_domains = self.cfg.registration.valid_email_domains

        self.pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

    def _hash_password(self, password: str) -> str:
        return self.pwd_context.hash(password)

    def _check_password(self, password: str, hashed_password: str) -> bool:
        return self.pwd_context.verify(password, hashed_password)

    def _create_access_token(self, data: dict):
        to_encode = data.copy()
        expire = datetime.utcnow() + self.cfg.api.access_token_validity
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(
            to_encode, self.cfg.api.secret_key, algorithm=ALGORITHM
        )
        return encoded_jwt

    def decode_jwt_payload(self, token: str) -> TokenMetadata:
        try:
            payload = jwt.decode(token, self.cfg.api.secret_key, algorithms=[ALGORITHM])
            try:
                return TokenMetadata.parse_obj(payload)
            except:
                raise PermissionError("invalid access token token")
        except JWTError:
            raise PermissionError

    @with_db_transaction
    async def get_user_from_token(self, *, conn: Connection, token: str) -> User:
        token_metadata = self.decode_jwt_payload(token)

        sess = await conn.fetchval(
            "select id from session "
            "where id = $1 and user_id = $2 and valid_until is null or valid_until > now()",
            token_metadata.session_id,
            token_metadata.user_id,
        )
        if not sess:
            raise PermissionError
        user = await self._get_user(conn=conn, user_id=token_metadata.user_id)
        if user is None:
            raise PermissionError
        return user

    async def _verify_user_password(self, user_id: int, password: str) -> bool:
        async with self.db_pool.acquire() as conn:
            user = await conn.fetchrow(
                "select hashed_password, pending, deleted from usr where id = $1",
                user_id,
            )
            if user is None:
                raise NotFoundError(f"User with id {user_id} does not exist")

            if user["deleted"] or user["pending"]:
                return False

            return self._check_password(password, user["hashed_password"])

    async def get_access_token_from_session_token(self, session_token: str) -> str:
        res = await self.is_session_token_valid(token=session_token)
        if res is None:
            raise PermissionError("invalid session token")
        user_id, session_id = res

        return self._create_access_token({"user_id": user_id, "session_id": session_id})

    @with_db_transaction
    async def is_session_token_valid(
        self, *, conn: Connection, token: str
    ) -> Optional[tuple[int, int]]:
        """returns the session id"""
        row = await conn.fetchrow(
            "select user_id, id from session where token = $1 and valid_until is null or valid_until > now()",
            token,
        )
        if row:
            await conn.execute(
                "update session set last_seen = now() where token = $1", token
            )

        return row

    @with_db_transaction
    async def login_user(
        self, *, conn: Connection, username: str, password: str, session_name: str
    ) -> tuple[int, int, str]:
        """
        validate whether a given user can login

        If successful return the user id, a new session id and a session token
        """
        user = await conn.fetchrow(
            "select id, hashed_password, pending, deleted from usr where username = $1 or email = $1",
            username,
        )
        if user is None:
            raise InvalidCommand(f"Login failed")

        if not self._check_password(password, user["hashed_password"]):
            raise InvalidCommand(f"Login failed")

        if user["deleted"]:
            raise InvalidCommand(f"User is not permitted to login")

        if user["pending"]:
            raise InvalidCommand(f"You need to confirm your email before logging in")

        session_token, session_id = await conn.fetchrow(
            "insert into session (user_id, name) values ($1, $2) returning token, id",
            user["id"],
            session_name,
        )

        return user["id"], session_id, str(session_token)

    @with_db_transaction
    async def logout_user(self, *, conn: Connection, user: User, session_id: int):
        sess_id = await conn.fetchval(
            "delete from session where id = $1 and user_id = $2 returning id",
            session_id,
            user.id,
        )
        if sess_id is None:
            raise InvalidCommand(f"Already logged out")

    @with_db_transaction
    async def demo_register_user(
        self, *, conn: Connection, username: str, email: str, password: str
    ) -> int:
        hashed_password = self._hash_password(password)
        user_id = await conn.fetchval(
            "insert into usr (username, email, hashed_password, pending) "
            "values ($1, $2, $3, false) returning id",
            username,
            email,
            hashed_password,
        )
        if user_id is None:
            raise InvalidCommand(f"Registering new user failed")

        return user_id

    def _validate_email_address(self, email: str) -> str:
        try:
            valid = validate_email(email)
            email = valid.email
        except EmailNotValidError as e:
            raise InvalidCommand(str(e))

        return email

    def _validate_email_domain(self, email: str) -> bool:
        if self.valid_email_domains is None:
            return True

        domain = email.split("@")[-1]
        if domain not in self.valid_email_domains:
            return False

        return True

    @with_db_transaction
    async def register_user(
        self,
        *,
        conn: Connection,
        username: str,
        email: str,
        password: str,
        invite_token: Optional[str] = None,
    ) -> int:
        """Register a new user, returning the newly created user id and creating a pending registration entry"""
        if not self.enable_registration:
            raise PermissionError(f"User registrations are disabled on this server")

        email = self._validate_email_address(email)

        is_guest_user = False
        has_valid_email = self._validate_email_domain(email)

        if invite_token is not None and self.allow_guest_users and not has_valid_email:
            invite = await conn.fetchval(
                "select id "
                "from group_invite where token = $1 and valid_until > now()",
                invite_token,
            )
            if invite is None:
                raise InvalidCommand("Invalid invite token")
            is_guest_user = True
            if self.enable_registration and has_valid_email:
                self._validate_email_domain(email)
        elif not has_valid_email:
            raise PermissionError(
                f"Only users with emails out of the following domains are "
                f"allowed: {self.valid_email_domains}"
            )

        hashed_password = self._hash_password(password)
        user_id = await conn.fetchval(
            "insert into usr (username, email, hashed_password, is_guest_user) values ($1, $2, $3, $4) returning id",
            username,
            email,
            hashed_password,
            is_guest_user,
        )
        if user_id is None:
            raise InvalidCommand(f"Registering new user failed")

        await conn.execute(
            "insert into pending_registration (user_id) values ($1)", user_id
        )

        return user_id

    @with_db_transaction
    async def confirm_registration(self, *, conn: Connection, token: str) -> int:
        row = await conn.fetchrow(
            "select user_id, valid_until from pending_registration where token = $1",
            token,
        )
        if row is None:
            raise PermissionError(f"Invalid registration token")

        user_id = row["user_id"]
        valid_until = row["valid_until"]
        if valid_until is None or valid_until < datetime.now(tz=timezone.utc):
            raise PermissionError(f"Invalid registration token")

        await conn.execute(
            "delete from pending_registration where user_id = $1", user_id
        )
        await conn.execute("update usr set pending = false where id = $1", user_id)

        return user_id

    async def _get_user(self, conn: asyncpg.Connection, user_id: int) -> User:
        user = await conn.fetchrow(
            "select id, email, registered_at, username, pending, deleted, is_guest_user "
            "from usr where id = $1",
            user_id,
        )

        if user is None:
            raise NotFoundError(f"User with id {user_id} does not exist")

        rows = await conn.fetch(
            "select id, name, valid_until, last_seen from session where user_id = $1",
            user_id,
        )
        sessions = [
            Session(
                id=row["id"],
                name=row["name"],
                valid_until=row["valid_until"],
                last_seen=row["last_seen"],
            )
            for row in rows
        ]

        return User(
            id=user["id"],
            email=user["email"],
            registered_at=user["registered_at"],
            username=user["username"],
            pending=user["pending"],
            deleted=user["deleted"],
            is_guest_user=user["is_guest_user"],
            sessions=sessions,
        )

    @with_db_transaction
    async def get_user(self, *, conn: Connection, user_id: int) -> User:
        return await self._get_user(conn, user_id)

    @with_db_transaction
    async def delete_session(self, *, conn: Connection, user: User, session_id: int):
        sess_id = await conn.fetchval(
            "delete from session where id = $1 and user_id = $2 returning id",
            session_id,
            user.id,
        )
        if not sess_id:
            raise NotFoundError(f"no such session found with id {session_id}")

    @with_db_transaction
    async def rename_session(
        self, *, conn: Connection, user: User, session_id: int, name: str
    ):
        sess_id = await conn.fetchval(
            "update session set name = $3 where id = $1 and user_id = $2 returning id",
            session_id,
            user.id,
            name,
        )
        if not sess_id:
            raise NotFoundError(f"no such session found with id {session_id}")

    @with_db_transaction
    async def change_password(
        self, *, conn: Connection, user: User, old_password: str, new_password: str
    ):
        valid_pw = await self._verify_user_password(user.id, old_password)
        if not valid_pw:
            raise InvalidPassword

        hashed_password = self._hash_password(new_password)
        await conn.execute(
            "update usr set hashed_password = $1 where id = $2",
            hashed_password,
            user.id,
        )

    @with_db_transaction
    async def request_email_change(
        self, *, conn: Connection, user: User, password: str, email: str
    ):
        try:
            valid = validate_email(email)
            email = valid.email
        except EmailNotValidError as e:
            raise InvalidCommand(str(e))

        valid_pw = await self._verify_user_password(user.id, password)
        if not valid_pw:
            raise InvalidPassword

        await conn.execute(
            "insert into pending_email_change (user_id, new_email) values ($1, $2)",
            user.id,
            email,
        )

    @with_db_transaction
    async def confirm_email_change(self, *, conn: Connection, token: str) -> int:
        row = await conn.fetchrow(
            "select user_id, new_email, valid_until from pending_email_change where token = $1",
            token,
        )
        user_id = row["user_id"]
        valid_until = row["valid_until"]
        if valid_until is None or valid_until < datetime.now(tz=timezone.utc):
            raise PermissionError

        await conn.execute(
            "delete from pending_email_change where user_id = $1", user_id
        )
        await conn.execute(
            "update usr set email = $2 where id = $1", user_id, row["new_email"]
        )

        return user_id

    @with_db_transaction
    async def request_password_recovery(self, *, conn: Connection, email: str):
        user_id = await conn.fetchval("select id from usr where email = $1", email)
        if not user_id:
            raise PermissionError

        await conn.execute(
            "insert into pending_password_recovery (user_id) values ($1)",
            user_id,
        )

    @with_db_transaction
    async def confirm_password_recovery(
        self, *, conn: Connection, token: str, new_password: str
    ) -> int:
        row = await conn.fetchrow(
            "select user_id, valid_until from pending_password_recovery where token = $1",
            token,
        )
        user_id = row["user_id"]
        valid_until = row["valid_until"]
        if valid_until is None or valid_until < datetime.now(tz=timezone.utc):
            raise PermissionError

        await conn.execute(
            "delete from pending_password_recovery where user_id = $1", user_id
        )
        hashed_password = self._hash_password(password=new_password)
        await conn.execute(
            "update usr set hashed_password = $2 where id = $1",
            user_id,
            hashed_password,
        )

        return user_id
