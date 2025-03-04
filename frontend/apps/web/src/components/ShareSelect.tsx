import { selectGroupAccounts } from "@abrechnung/redux";
import { Account, TransactionShare } from "@abrechnung/types";
import { Clear as ClearIcon, Search as SearchIcon } from "@mui/icons-material";
import {
    Box,
    Checkbox,
    Divider,
    FormControlLabel,
    Grid,
    IconButton,
    InputAdornment,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Chip,
    Theme,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { Link } from "react-router-dom";
import * as React from "react";
import { selectAccountSlice, useAppSelector } from "../store";
import { NumericInput } from "./NumericInput";
import { getAccountIcon } from "./style/AbrechnungIcons";
import { getAccountLink } from "../utils";

interface RowProps {
    account: Account;
    showAdvanced: boolean;
    editable: boolean;
    onChange: (accountId: number, newShareValue: number) => void;
    renderAdditionalShareInfo?: React.FC<{ account: Account }> | undefined;
    shareValue?: number | undefined;
}

const ShareSelectRow: React.FC<RowProps> = ({
    account,
    editable,
    showAdvanced,
    shareValue,
    onChange,
    renderAdditionalShareInfo,
}) => {
    const theme = useTheme();
    const handleChange = (newValue: number) => {
        onChange(account.id, newValue);
    };

    const handleToggleShare = (event) => {
        if (event.target.checked) {
            onChange(account.id, 1);
        } else {
            onChange(account.id, 0);
        }
    };

    return (
        <TableRow hover>
            <TableCell>
                <Link
                    style={{
                        color: theme.palette.text.primary,
                        textDecoration: "none",
                        display: "block",
                        height: "100%",
                        width: "100%",
                    }}
                    to={getAccountLink(account.groupID, account.type, account.id)}
                >
                    <Grid container direction="row" alignItems="center">
                        <Grid item>{getAccountIcon(account.type)}</Grid>
                        <Grid item sx={{ ml: 1, display: "flex", flexDirection: "column" }}>
                            <Typography variant="body2" component="span">
                                {account.name}
                            </Typography>
                            {account.type === "clearing" && account.dateInfo != null && (
                                <Typography variant="caption" component="span">
                                    {account.dateInfo}
                                </Typography>
                            )}
                        </Grid>
                    </Grid>
                </Link>
            </TableCell>
            <TableCell width="100px">
                {showAdvanced ? (
                    <NumericInput value={shareValue ?? 0} onChange={handleChange} disabled={!editable} />
                ) : (
                    <Checkbox checked={(shareValue ?? 0) > 0} disabled={!editable} onChange={handleToggleShare} />
                )}
            </TableCell>
            {renderAdditionalShareInfo ? renderAdditionalShareInfo({ account }) : null}
        </TableRow>
    );
};

interface ShareSelectProps {
    groupId: number;
    label: string;
    value: TransactionShare;
    onChange: (newShares: TransactionShare) => void;
    error?: boolean | undefined;
    helperText?: React.ReactNode | undefined;
    shouldDisplayAccount?: (accountId: number) => boolean | undefined;
    additionalShareInfoHeader?: React.ReactNode | undefined;
    renderAdditionalShareInfo?: React.FC<{ account: Account }> | undefined;
    excludeAccounts?: number[] | undefined;
    editable?: boolean | undefined;
}

export const ShareSelect: React.FC<ShareSelectProps> = ({
    groupId,
    label,
    value,
    onChange,
    shouldDisplayAccount,
    additionalShareInfoHeader,
    renderAdditionalShareInfo,
    excludeAccounts,
    error,
    helperText,
    editable = false,
}) => {
    const theme = useTheme();
    const isSmallScreen = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));

    const [searchValue, setSearchValue] = React.useState("");

    const isAccountShown = (accountId: number) => {
        if (editable) {
            return true;
        }
        if (shouldDisplayAccount) {
            return shouldDisplayAccount(accountId);
        }

        return value[accountId] !== undefined;
    };

    const accounts = useAppSelector((state) => {
        const accounts = selectGroupAccounts({
            state: selectAccountSlice(state),
            groupId,
        });
        return accounts.filter((a) => {
            if (excludeAccounts && excludeAccounts.includes(a.id)) {
                return false;
            }
            if (!isAccountShown(a.id)) {
                return false;
            }
            if (searchValue && searchValue !== "") {
                if (
                    a.name.toLowerCase().includes(searchValue.toLowerCase()) ||
                    a.description.toLowerCase().includes(searchValue.toLowerCase()) ||
                    (a.type === "clearing" && a.dateInfo && a.dateInfo.includes(searchValue.toLowerCase()))
                ) {
                    return true;
                }
                return false;
            }
            return true;
        });
    });

    const [showAdvanced, setShowAdvanced] = React.useState(false);

    React.useEffect(() => {
        if (Object.values(value).reduce((showAdvanced, value) => showAdvanced || value !== 1, false)) {
            setShowAdvanced(true);
        }
    }, [value, setShowAdvanced]);

    const nSelectedPeople = accounts.reduce((nAccs: number, acc: Account) => {
        if (acc.type !== "personal") {
            return nAccs;
        }
        if ((shouldDisplayAccount && shouldDisplayAccount(acc.id)) || value[acc.id] > 0) {
            return nAccs + 1;
        }
        return nAccs;
    }, 0);
    const nSelectedEvents = accounts.reduce((nAccs: number, acc: Account) => {
        if (acc.type !== "clearing") {
            return nAccs;
        }
        if ((shouldDisplayAccount && shouldDisplayAccount(acc.id)) || value[acc.id] > 0) {
            return nAccs + 1;
        }
        return nAccs;
    }, 0);
    const showSearch = !isSmallScreen && accounts.length > 5;

    const handleAccountShareChange = (accountId: number, shareValue: number) => {
        const newValue = { ...value };
        if (shareValue === 0) {
            delete newValue[accountId];
            return onChange(newValue);
        } else {
            newValue[accountId] = shareValue;
            return onChange(newValue);
        }
    };

    return (
        <div>
            <Grid container direction="row" justifyContent="space-between">
                <Box sx={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.5em", marginY: 1 }}>
                    <Typography variant="subtitle1">{label}</Typography>
                    {nSelectedPeople > 0 && <Chip label={`${nSelectedPeople} People`} size="small" color="primary" />}
                    {nSelectedEvents > 0 && <Chip label={`${nSelectedEvents} Events`} size="small" color="primary" />}
                </Box>
                {editable && (
                    <FormControlLabel
                        control={<Checkbox name={`show-advanced`} />}
                        checked={showAdvanced}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowAdvanced(event.target.checked)}
                        label="Advanced"
                    />
                )}
            </Grid>
            <Divider variant="middle" sx={{ marginLeft: 0 }} />
            <TableContainer
                sx={{
                    maxHeight: { md: 400 },
                    borderColor: error ? theme.palette.error.main : undefined,
                    borderWidth: error ? 2 : undefined,
                    borderStyle: error ? "solid" : undefined,
                }}
            >
                {helperText && (
                    <Typography variant="body2" color={error ? theme.palette.error.main : undefined} sx={{ margin: 1 }}>
                        {helperText}
                    </Typography>
                )}
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell>
                                {!showSearch ? (
                                    "Account / Event"
                                ) : (
                                    <TextField
                                        placeholder="Search ..."
                                        margin="none"
                                        size="small"
                                        value={searchValue}
                                        onChange={(e) => setSearchValue(e.target.value)}
                                        variant="standard"
                                        InputProps={{
                                            startAdornment: (
                                                <InputAdornment position="start">
                                                    <SearchIcon />
                                                </InputAdornment>
                                            ),
                                            endAdornment: (
                                                <InputAdornment position="end">
                                                    <IconButton
                                                        aria-label="clear search input"
                                                        onClick={(e) => setSearchValue("")}
                                                        edge="end"
                                                    >
                                                        <ClearIcon />
                                                    </IconButton>
                                                </InputAdornment>
                                            ),
                                        }}
                                    />
                                )}
                            </TableCell>
                            <TableCell width="100px">Shares</TableCell>
                            {additionalShareInfoHeader ?? null}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {accounts
                            .filter((account) => isAccountShown(account.id))
                            .map((account) => (
                                <ShareSelectRow
                                    key={account.id}
                                    editable={editable}
                                    account={account}
                                    onChange={handleAccountShareChange}
                                    shareValue={value[account.id]}
                                    showAdvanced={showAdvanced}
                                    renderAdditionalShareInfo={renderAdditionalShareInfo}
                                />
                            ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </div>
    );
};
