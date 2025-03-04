import {
    positionDeleted,
    selectGroupAccounts,
    selectTransactionBalanceEffect,
    selectTransactionById,
    selectTransactionPositionsWithEmpty,
    wipPositionAdded,
    wipPositionUpdated,
} from "@abrechnung/redux";
import { Account, PositionValidator, TransactionPosition } from "@abrechnung/types";
import { Add, ContentCopy, Delete } from "@mui/icons-material";
import {
    Checkbox,
    FormControlLabel,
    FormHelperText,
    Grid,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
    useTheme,
} from "@mui/material";
import React, { useState } from "react";
import { typeToFlattenedError, z } from "zod";
import AccountSelect from "../../../../components/AccountSelect";
import { NumericInput } from "../../../../components/NumericInput";
import { MobilePaper } from "../../../../components/style/mobile";
import { TextInput } from "../../../../components/TextInput";
import { selectAccountSlice, selectTransactionSlice, useAppDispatch, useAppSelector } from "../../../../store";

interface PositionTableRowProps {
    position: TransactionPosition;
    updatePosition: (
        position: TransactionPosition,
        newName: string,
        newPrice: number,
        newCommunistShares: number
    ) => void;
    transactionAccounts: number[];
    showAdvanced: boolean;
    copyPosition: (position: TransactionPosition) => void;
    updatePositionUsage: (position: TransactionPosition, accountID: number, usages: number) => void;
    showAccountSelect: boolean;
    showAddAccount: boolean;
    deletePosition: (position: TransactionPosition) => void;
    validationError?: PositionValidationError;
}

const PositionTableRow: React.FC<PositionTableRowProps> = ({
    position,
    updatePosition,
    transactionAccounts,
    showAdvanced,
    copyPosition,
    updatePositionUsage,
    showAccountSelect,
    showAddAccount,
    deletePosition,
    validationError,
}) => {
    const theme = useTheme();

    const error = validationError !== undefined;

    return (
        <TableRow
            hover
            sx={{
                borderColor: error ? theme.palette.error.main : undefined,
                borderWidth: error ? 2 : undefined,
                borderStyle: error ? "solid" : undefined,
            }}
        >
            <TableCell>
                {validationError && validationError.formErrors && (
                    <FormHelperText sx={{ marginLeft: 0 }} error={true}>
                        {validationError.formErrors}
                    </FormHelperText>
                )}
                {validationError && validationError.fieldErrors.communistShares && (
                    <FormHelperText sx={{ marginLeft: 0 }} error={true}>
                        {validationError.fieldErrors.communistShares}
                    </FormHelperText>
                )}
                {validationError && validationError.fieldErrors.usages && (
                    <FormHelperText sx={{ marginLeft: 0 }} error={true}>
                        {validationError.fieldErrors.usages}
                    </FormHelperText>
                )}
                <TextInput
                    value={position.name}
                    error={validationError && !!validationError.fieldErrors.name}
                    helperText={validationError && validationError.fieldErrors.name}
                    onChange={(value) => updatePosition(position, value, position.price, position.communistShares)}
                />
            </TableCell>
            <TableCell align="right">
                <NumericInput
                    value={position.price}
                    style={{ width: 70 }}
                    error={validationError && !!validationError.fieldErrors.price}
                    helperText={validationError && validationError.fieldErrors.price}
                    onChange={(value) => updatePosition(position, position.name, value, position.communistShares)}
                />
            </TableCell>
            {transactionAccounts.map((accountID) => (
                <TableCell align="right" key={accountID}>
                    {showAdvanced ? (
                        <NumericInput
                            sx={{ maxWidth: 50 }}
                            value={position.usages[accountID] !== undefined ? position.usages[String(accountID)] : 0}
                            error={validationError && !!validationError.fieldErrors.usages}
                            onChange={(value) => updatePositionUsage(position, accountID, value)}
                            inputProps={{ tabIndex: -1 }}
                        />
                    ) : (
                        <Checkbox
                            name={`${accountID}-checked`}
                            checked={position.usages[accountID] !== undefined}
                            onChange={(event) => updatePositionUsage(position, accountID, event.target.checked ? 1 : 0)}
                            inputProps={{ tabIndex: -1 }}
                        />
                    )}
                </TableCell>
            ))}
            {showAccountSelect && <TableCell></TableCell>}
            {showAddAccount && <TableCell></TableCell>}
            <TableCell align="right">
                {showAdvanced ? (
                    <NumericInput
                        value={position.communistShares}
                        sx={{ maxWidth: 50 }}
                        onChange={(value) => updatePosition(position, position.name, position.price, value)}
                        error={validationError && !!validationError.fieldErrors.communistShares}
                        inputProps={{ tabIndex: -1 }}
                    />
                ) : (
                    <Checkbox
                        name="communist-checked"
                        checked={position.communistShares !== 0}
                        onChange={(event) =>
                            updatePosition(position, position.name, position.price, event.target.checked ? 1 : 0)
                        }
                        inputProps={{ tabIndex: -1 }}
                    />
                )}
            </TableCell>
            <TableCell sx={{ minWidth: "120px" }}>
                <IconButton onClick={() => copyPosition(position)} tabIndex={-1}>
                    <ContentCopy />
                </IconButton>
                <IconButton onClick={() => deletePosition(position)} tabIndex={-1}>
                    <Delete />
                </IconButton>
            </TableCell>
        </TableRow>
    );
};

type PositionValidationError = typeToFlattenedError<z.infer<typeof PositionValidator>>;
export type ValidationErrors = {
    [positionId: number]: PositionValidationError;
};

interface TransactionPositionsProps {
    groupId: number;
    transactionId: number;
    validationErrors?: ValidationErrors;
}

export const TransactionPositions: React.FC<TransactionPositionsProps> = ({
    groupId,
    transactionId,
    validationErrors,
}) => {
    const accounts = useAppSelector((state) => selectGroupAccounts({ state: selectAccountSlice(state), groupId }));
    const transaction = useAppSelector((state) =>
        selectTransactionById({ state: selectTransactionSlice(state), groupId, transactionId })
    );
    const { positions, positionsHaveComplexShares } = useAppSelector((state) => {
        const positions = selectTransactionPositionsWithEmpty({
            state: selectTransactionSlice(state),
            groupId,
            transactionId,
        });
        const positionsHaveComplexShares = positions.reduce(
            (hasComplex, position) =>
                hasComplex ||
                (position.communistShares !== 0 && position.communistShares !== 1) ||
                Object.values(position.usages).reduce((nonOne, usage) => nonOne || (usage !== 0 && usage !== 1), false),
            false
        );
        return { positions, positionsHaveComplexShares };
    });
    const transactionBalanceEffect = useAppSelector((state) =>
        selectTransactionBalanceEffect({ state: selectTransactionSlice(state), groupId, transactionId })
    );

    const dispatch = useAppDispatch();
    const [showAdvanced, setShowAdvanced] = useState(false);

    // find all accounts that take part in the transaction, either via debitor shares or purchase items
    // TODO: should we add creditor accounts as well?
    const positionAccounts: number[] = Array.from(
        new Set<number>(
            positions
                .map((item) => Object.keys(item.usages))
                .flat()
                .map((id) => parseInt(id))
        )
    );

    const [additionalPurchaseItemAccounts, setAdditionalPurchaseItemAccounts] = useState([]);
    const transactionAccounts: number[] = Array.from(
        new Set<number>(
            Object.keys(transaction.debitorShares)
                .map((id) => parseInt(id))
                .concat(positionAccounts)
                .concat(additionalPurchaseItemAccounts)
        )
    );

    const showAddAccount = transactionAccounts.length < accounts.length;

    const [showAccountSelect, setShowAccountSelect] = useState(false);

    const totalPositionValue = positions.reduce((acc, curr) => acc + curr.price, 0);
    const sharedTransactionValue = transaction.value - totalPositionValue;

    const purchaseItemSumForAccount = (accountID) => {
        return transactionBalanceEffect[accountID] !== undefined ? transactionBalanceEffect[accountID].positions : 0;
    };

    const updatePosition = (position: TransactionPosition, name: string, price: number, communistShares: number) => {
        dispatch(
            wipPositionUpdated({ groupId, transactionId, position: { ...position, name, price, communistShares } })
        );
    };

    const updatePositionUsage = (position: TransactionPosition, accountID: number, shares: number) => {
        const usages = { ...position.usages };
        if (shares === 0) {
            delete usages[accountID];
        } else {
            usages[accountID] = shares;
        }
        dispatch(wipPositionUpdated({ groupId, transactionId, position: { ...position, usages } }));
    };

    const deletePosition = (position: TransactionPosition) => {
        dispatch(positionDeleted({ groupId, transactionId, positionId: position.id }));
    };

    const copyPosition = (position: TransactionPosition) => {
        dispatch(wipPositionAdded({ groupId, transactionId, position }));
    };

    const addPurchaseItemAccount = (account: Account) => {
        setShowAccountSelect(false);
        setAdditionalPurchaseItemAccounts((currAdditionalAccounts) =>
            Array.from(new Set<number>([...currAdditionalAccounts, account.id]))
        );
    };

    return (
        <MobilePaper sx={{ marginTop: 2 }}>
            <Grid container direction="row" justifyContent="space-between">
                <Typography>Positions</Typography>
                {transaction.isWip && (
                    <FormControlLabel
                        control={<Checkbox name={`show-advanced`} />}
                        checked={showAdvanced}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowAdvanced(event.target.checked)}
                        label="Advanced"
                    />
                )}
            </Grid>
            <TableContainer>
                <Table sx={{ minWidth: 650 }} stickyHeader aria-label="purchase items" size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell align="right">Price</TableCell>
                            {(transaction.isWip ? transactionAccounts : positionAccounts).map((accountID) => (
                                <TableCell align="right" sx={{ minWidth: 80 }} key={accountID}>
                                    {accounts.find((account) => account.id === accountID).name}
                                </TableCell>
                            ))}
                            {transaction.isWip && (
                                <>
                                    {showAccountSelect && (
                                        <TableCell align="right">
                                            <AccountSelect
                                                groupId={groupId}
                                                exclude={transactionAccounts}
                                                onChange={addPurchaseItemAccount}
                                            />
                                        </TableCell>
                                    )}
                                    {showAddAccount && (
                                        <TableCell align="right">
                                            <IconButton onClick={() => setShowAccountSelect(true)}>
                                                <Add />
                                            </IconButton>
                                        </TableCell>
                                    )}
                                </>
                            )}
                            <TableCell align="right">Shared</TableCell>
                            {transaction.isWip && <TableCell></TableCell>}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {transaction.isWip
                            ? positions.map((position, idx) => (
                                  <PositionTableRow
                                      key={position.id}
                                      position={position}
                                      deletePosition={deletePosition}
                                      transactionAccounts={transactionAccounts}
                                      copyPosition={copyPosition}
                                      updatePosition={updatePosition}
                                      updatePositionUsage={updatePositionUsage}
                                      showAdvanced={showAdvanced}
                                      showAccountSelect={showAccountSelect}
                                      showAddAccount={showAddAccount}
                                      validationError={validationErrors[position.id]}
                                  />
                              ))
                            : positions.map((position) => (
                                  <TableRow hover key={position.id}>
                                      <TableCell>{position.name}</TableCell>
                                      <TableCell align="right" style={{ minWidth: 80 }}>
                                          {position.price.toFixed(2)} {transaction.currencySymbol}
                                      </TableCell>
                                      {positionAccounts.map((accountID) => (
                                          <TableCell align="right" key={accountID}>
                                              {positionsHaveComplexShares ? (
                                                  position.usages[accountID] !== undefined ? (
                                                      position.usages[String(accountID)]
                                                  ) : (
                                                      0
                                                  )
                                              ) : (
                                                  <Checkbox
                                                      checked={(position.usages[accountID] ?? 0) !== 0}
                                                      disabled={true}
                                                  />
                                              )}
                                          </TableCell>
                                      ))}
                                      <TableCell align="right">
                                          {positionsHaveComplexShares ? (
                                              position.communistShares
                                          ) : (
                                              <Checkbox checked={position.communistShares !== 0} disabled={true} />
                                          )}
                                      </TableCell>
                                  </TableRow>
                              ))}
                        <TableRow hover>
                            <TableCell>
                                <Typography sx={{ fontWeight: "bold" }}>Total:</Typography>
                            </TableCell>
                            <TableCell align="right">
                                {totalPositionValue.toFixed(2)} {transaction.currencySymbol}
                            </TableCell>
                            {(transaction.isWip ? transactionAccounts : positionAccounts).map((accountID) => (
                                <TableCell align="right" key={accountID}>
                                    {purchaseItemSumForAccount(accountID).toFixed(2)} {transaction.currencySymbol}
                                </TableCell>
                            ))}
                            <TableCell align="right" colSpan={showAddAccount ? 2 : 1}>
                                {(
                                    positions.reduce((acc, curr) => acc + curr.price, 0) -
                                    Object.values(transactionBalanceEffect).reduce(
                                        (acc, curr) => acc + curr.positions,
                                        0
                                    )
                                ).toFixed(2)}{" "}
                                {transaction.currencySymbol}
                            </TableCell>
                            {transaction.isWip && <TableCell></TableCell>}
                        </TableRow>
                        <TableRow hover>
                            <TableCell>
                                <Typography sx={{ fontWeight: "bold" }}>Remaining:</Typography>
                            </TableCell>
                            <TableCell align="right">
                                {sharedTransactionValue.toFixed(2)} {transaction.currencySymbol}
                            </TableCell>
                            {(transaction.isWip ? transactionAccounts : positionAccounts).map((accountID) => (
                                <TableCell align="right" key={accountID}></TableCell>
                            ))}
                            <TableCell align="right" colSpan={showAddAccount ? 2 : 1}></TableCell>
                            {transaction.isWip && <TableCell></TableCell>}
                        </TableRow>
                    </TableBody>
                </Table>
            </TableContainer>
        </MobilePaper>
    );
};

export default TransactionPositions;
