import React from "react";
import { Form, Formik, FormikHelpers, FormikProps } from "formik";
import { api } from "../../core/api";
import { toast } from "react-toastify";
import { Button, LinearProgress, TextField, Typography } from "@mui/material";
import { MobilePaper } from "../../components/style/mobile";
import { useTitle } from "../../core/utils";
import { z } from "zod";
import { toFormikValidationSchema } from "@abrechnung/utils";
import { useTranslation } from "react-i18next";

const validationSchema = z
    .object({
        password: z.string({ required_error: "password is required" }),
        newPassword: z.string({ required_error: "new password is required" }),
        newPassword2: z.string({ required_error: "please repeat your desired new password" }),
    })
    .refine((data) => data.newPassword === data.newPassword2, {
        message: "passwords don't match",
        path: ["newPassword2"],
    });
type FormSchema = z.infer<typeof validationSchema>;

export const ChangePassword: React.FC = () => {
    const { t } = useTranslation();
    useTitle(t("Abrechnung - Change Password"));

    const handleSubmit = (values: FormSchema, { setSubmitting, resetForm }: FormikHelpers<FormSchema>) => {
        api.changePassword({ oldPassword: values.password, newPassword: values.newPassword })
            .then(() => {
                setSubmitting(false);
                toast.success(t("Successfully changed password"));
                resetForm();
            })
            .catch((error) => {
                setSubmitting(false);
                toast.error(error.toString());
            });
    };

    return (
        <MobilePaper>
            <Typography component="h3" variant="h5">
                {t("Change Password")}
            </Typography>
            <Formik
                validationSchema={toFormikValidationSchema(validationSchema)}
                initialValues={{
                    password: "",
                    newPassword: "",
                    newPassword2: "",
                }}
                onSubmit={handleSubmit}
            >
                {({ values, handleChange, handleBlur, isSubmitting, errors, touched }: FormikProps<FormSchema>) => (
                    <Form>
                        <TextField
                            fullWidth
                            autoFocus
                            margin="normal"
                            type="password"
                            name="password"
                            label={t("Password")}
                            variant="standard"
                            value={values.password}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            error={touched.password && !!errors.password}
                            helperText={touched.password && errors.password}
                        />

                        <TextField
                            fullWidth
                            margin="normal"
                            type="password"
                            name="newPassword"
                            label={t("New Password")}
                            variant="standard"
                            value={values.newPassword}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            error={touched.newPassword && !!errors.newPassword}
                            helperText={touched.newPassword && errors.newPassword}
                        />

                        <TextField
                            fullWidth
                            variant="standard"
                            value={values.newPassword2}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            margin="normal"
                            type="password"
                            name="newPassword2"
                            label={t("Repeat Password")}
                            error={touched.newPassword2 && !!errors.newPassword2}
                            helperText={touched.newPassword2 && errors.newPassword2}
                        />

                        {isSubmitting && <LinearProgress />}
                        <Button type="submit" color="primary" disabled={isSubmitting}>
                            {t("Save")}
                        </Button>
                    </Form>
                )}
            </Formik>
        </MobilePaper>
    );
};

export default ChangePassword;
