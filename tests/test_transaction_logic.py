# pylint: disable=attribute-defined-outside-init,missing-kwoa
import os
from datetime import datetime

from abrechnung.application.accounts import AccountService
from abrechnung.application.groups import GroupService
from abrechnung.application.transactions import TransactionService
from .common import BaseTestCase


class TransactionLogicTest(BaseTestCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        self.group_service = GroupService(self.db_pool, config=self.test_config)
        self.account_service = AccountService(self.db_pool, config=self.test_config)
        self.transaction_service = TransactionService(
            self.db_pool, config=self.test_config
        )

        self.user, _ = await self._create_test_user("test", "test@test.test")
        self.group_id = await self.group_service.create_group(
            user=self.user,
            name="test group",
            description="",
            currency_symbol="€",
            terms="",
            add_user_account_on_join=False,
        )

    async def _create_accounts(
        self,
        group_id: int,
        n_accounts: int,
        account_type: str = "personal",
    ) -> list[int]:
        account_ids = []
        for i in range(n_accounts):
            acc_id = await self.account_service.create_account(
                user=self.user,
                group_id=group_id,
                type=account_type,
                name=f"account{i}",
                description="",
                date_info=datetime.now().date() if account_type == "clearing" else None,
            )
            account_ids.append(acc_id)

        return account_ids

    async def test_basic_clearing_account_workflow(self):
        basic_account_id1, basic_account_id2 = await self._create_accounts(
            self.group_id, 2
        )

        # check that we can create a simple clearing account
        account_id = await self.account_service.create_account(
            user=self.user,
            group_id=self.group_id,
            type="clearing",
            name="Clearing",
            description="Foobar",
            clearing_shares={basic_account_id1: 1.0, basic_account_id2: 2.0},
            date_info=datetime.now().date(),
        )

        account = await self.account_service.get_account(
            user=self.user, account_id=account_id
        )
        self.assertEqual(account_id, account.id)
        self.assertFalse(account.is_wip)
        self.assertIsNotNone(account.committed_details)
        self.assertIsNone(account.pending_details)
        self.assertEqual(
            2.0, account.committed_details.clearing_shares[basic_account_id2]
        )
        self.assertEqual(
            1.0, account.committed_details.clearing_shares[basic_account_id1]
        )

        await self.account_service.update_account(
            user=self.user,
            account_id=account_id,
            name="Clearing",
            description="Foobar",
            date_info=datetime.now().date(),
            clearing_shares={basic_account_id1: 1.0},
        )
        account = await self.account_service.get_account(
            user=self.user, account_id=account_id
        )
        self.assertIsNotNone(account.committed_details)
        self.assertIsNone(account.pending_details)
        self.assertTrue(
            basic_account_id2 not in account.committed_details.clearing_shares
        )
        self.assertFalse(account.is_wip)

    async def test_no_circular_clearing_accounts(self):
        account1_id, account2_id = await self._create_accounts(
            self.group_id, 2, account_type="clearing"
        )

        # we need to commit one account first other
        await self.account_service.update_account(
            user=self.user,
            account_id=account2_id,
            name="account2",
            description="",
            date_info=datetime.now().date(),
            clearing_shares={account1_id: 1.0},
        )

        with self.assertRaises(Exception) as ctx:
            await self.account_service.update_account(
                user=self.user,
                account_id=account1_id,
                name="account1",
                description="",
                date_info=datetime.now().date(),
                clearing_shares={account2_id: 1.0},
            )
        self.assertTrue(
            "this change would result in a cyclic dependency between clearing accounts"
            in str(ctx.exception)
        )

        # check that we cannot have an account reference itself
        with self.assertRaises(Exception) as ctx:
            await self.account_service.update_account(
                user=self.user,
                account_id=account1_id,
                name="account1",
                description="",
                date_info=datetime.now().date(),
                clearing_shares={account1_id: 1.0},
            )

    async def test_file_upload(self):
        account1_id, account2_id = await self._create_accounts(self.group_id, 2)
        transaction_id = await self.transaction_service.create_transaction(
            user=self.user,
            group_id=self.group_id,
            type="purchase",
            name="foo",
            description="foo",
            billed_at=datetime.now().date(),
            currency_symbol="€",
            currency_conversion_rate=1.0,
            tags=[],
            value=33,
            debitor_shares={account1_id: 1.0},
            creditor_shares={account2_id: 1.0},
        )
        with open(
            os.path.join(os.path.dirname(__file__), "assets", "test_image.jpg"), "rb"
        ) as test_image:
            content = test_image.read()
            file_size = len(content)
            file_id = await self.transaction_service.upload_file(
                user=self.user,
                transaction_id=transaction_id,
                filename="test file",
                mime_type="image/jpeg",
                content=content,
            )
        transaction = await self.transaction_service.get_transaction(
            user=self.user, transaction_id=transaction_id
        )
        self.assertIsNotNone(transaction.pending_files)
        self.assertIsNone(transaction.committed_files)
        self.assertEqual(1, len(transaction.pending_files))
        self.assertEqual(file_id, transaction.pending_files[0].id)
        await self.transaction_service.commit_transaction(
            user=self.user, transaction_id=transaction_id
        )

        transaction = await self.transaction_service.get_transaction(
            user=self.user, transaction_id=transaction_id
        )
        self.assertIsNone(transaction.pending_files)
        self.assertIsNotNone(transaction.committed_files)
        self.assertEqual(1, len(transaction.committed_files))
        self.assertEqual(file_id, transaction.committed_files[0].id)
        self.assertIsNotNone(transaction.committed_files[0].blob_id)

        (
            mime_type,
            _,
        ) = await self.transaction_service.read_file_contents(
            user=self.user,
            file_id=file_id,
            blob_id=transaction.committed_files[0].blob_id,
        )
        self.assertEqual("image/jpeg", mime_type)
        self.assertEqual(file_size, len(content))

        # now delete it
        await self.transaction_service.delete_file(user=self.user, file_id=file_id)
        transaction = await self.transaction_service.get_transaction(
            user=self.user, transaction_id=transaction_id
        )
        self.assertIsNotNone(transaction.pending_files)
        self.assertIsNotNone(transaction.committed_files)
        self.assertEqual(1, len(transaction.pending_files))
        self.assertEqual(file_id, transaction.pending_files[0].id)
        self.assertTrue(transaction.pending_files[0].deleted)
        await self.transaction_service.commit_transaction(
            user=self.user, transaction_id=transaction_id
        )
        transaction = await self.transaction_service.get_transaction(
            user=self.user, transaction_id=transaction_id
        )
        self.assertIsNone(transaction.pending_files)
        self.assertIsNotNone(transaction.committed_files)
        self.assertEqual(1, len(transaction.committed_files))
        self.assertEqual(file_id, transaction.committed_files[0].id)
        self.assertIsNone(transaction.committed_files[0].blob_id)
        self.assertTrue(transaction.committed_files[0].deleted)
