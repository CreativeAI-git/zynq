import Joi from "joi";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import ejs from "ejs";
import path from "path";
import { fileURLToPath } from "url";
import dayjs from 'dayjs';
import axios from "axios";

import * as apiModels from "../../models/api.js";
import * as adminModels from "../../models/admin.js";
import * as walletModel from '../../models/wallet.js';
import { sendEmail } from "../../services/send_email.js";
import { generateAccessTokenAdmin, generateAccessTokenVerifyAdmin } from "../../utils/user_helper.js";
import { handleError, handleSuccess, joiErrorHandle } from "../../utils/responseHandler.js";
import * as appointmentModel from '../../models/appointment.js';
import { updateMissedAppointmentStatusModel } from "../../models/appointment.js";
import { v4 as uuidv4 } from 'uuid';
import { NOTIFICATION_MESSAGES, sendNotification } from "../../services/notifications.service.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const image_logo = process.env.LOGO_URL

export const login = async (req, res) => {
    try {
        const loginSchema = Joi.object({
            email: Joi.string().email().required(),
            password: Joi.string().required(),
            fcm_token: Joi.string().optional().allow('', null)
        });

        const { error, value } = loginSchema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { email, password, fcm_token } = value;

        const [user] = await adminModels.findEmail(email);
        if (!user) return handleError(res, 404, "en", "User not found or invalid email.");

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return handleError(res, 404, "en", "Incorrect password.");

        const token = generateAccessTokenAdmin({ id: user.admin_id, fcm_token });
        await adminModels.updateData(user.admin_id, token, fcm_token);

        return handleSuccess(res, 200, "en", "Login successful.", {
            token,
            user: {
                id: user.admin_id,
                name: user.full_name,
                email: user.email,
                phone: user.mobile_number,
                profile_image: process.env.APP_URL + user.profile_image
            },
        });
    } catch (error) {
        console.error("Login error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const forgotPassword = async (req, res) => {
    try {
        const forgetSchema = Joi.object({
            email: Joi.string().email().required()
        });

        const { error, value } = forgetSchema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { email } = value;

        const [user] = await adminModels.findEmail(email);
        if (!user) return handleError(res, 404, "en", "No account found with this email address.");

        const token = generateAccessTokenAdmin({ id: user.admin_id });
        await adminModels.updateData(user.admin_id, token, user.fcm_token);

        const resetLink = `${process.env.LOCAL_APP_URL}admin/reset-password/${token}`;
        const html = await ejs.renderFile(path.join(__dirname, "../../views/ZYNQ_all_mail-template/forgot-password.ejs"), { image_logo, resetLink });

        await sendEmail({
            to: email,
            subject: "Password Reset Request",
            html,
        });

        return handleSuccess(res, 200, "en", "A password reset link has been sent to your email.");
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const renderResetPasswordPage = async (req, res) => {
    const forgetSchema = Joi.object({
        token: Joi.string().required()
    });

    const { error, value } = forgetSchema.validate(req.params);
    if (error) return joiErrorHandle(res, error);

    const { token } = value;

    const decoded = generateAccessTokenVerifyAdmin(token);
    if (!decoded || !decoded.id) return res.status(400).render("errorPage.ejs", { message: "Invalid or expired reset token." });

    const user = await adminModels.findById(decoded.id);
    if (!user) return res.status(404).render("errorPage.ejs", { message: "User not found or token is invalid." });

    res.render("Zynq-forgot-password/forgot-password-zynq.ejs");
};

export const resetPassword = async (req, res) => {
    const forgetSchema = Joi.object({
        token: Joi.string().required(),
        new_password: Joi.string().min(6).required(),
        confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
            .messages({ 'any.only': 'Passwords do not match.' })
    });

    const { error, value } = forgetSchema.validate(req.body);
    if (error) return joiErrorHandle(res, error);

    const { token, new_password } = value;

    const decoded = generateAccessTokenVerifyAdmin(token);
    if (!decoded || !decoded.id) return res.status(400).render("errorPage.ejs", { message: "Invalid or expired reset token." });

    const hashedPassword = await bcrypt.hash(new_password, 10);
    await adminModels.updatePassword(decoded.id, hashedPassword)

    res.json({
        message: "Password reset successful. You can now login.",
        redirectUrl: "/admin/success-change"
    });
};

export const successChange = async (req, res) => {
    res.render("success_reset/admin_en.ejs");
};

export const profile = async (req, res) => {
    try {
        const user = req.admin;
        if (user) {
            user.profile_image = user.profile_image == null ? null : process.env.APP_URL + user.profile_image;
            return handleSuccess(res, 200, "en", "Admin profile fetched successfully", user);
        } else {
            return handleError(res, 404, "en", "Admin not found");
        }
    } catch (error) {
        console.error("Update profile error:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const updateProfile = async (req, res) => {
    try {
        const schema = Joi.object({
            email: Joi.string().email().required(),
            full_name: Joi.string().min(2).required(),
            mobile_number: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const admin = req.admin;
        if (!admin) return handleError(res, 401, "en", "Unauthorized");

        const profileImage = req.file ? req.file.filename : admin.profile_image;

        const updateData = {
            ...value,
            profile_image: profileImage
        };

        await adminModels.updateProfile(admin.admin_id, updateData);

        return handleSuccess(res, 200, "en", "Profile updated successfully");
    } catch (error) {
        console.error("Update profile error:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const changePassword = async (req, res) => {
    try {
        const schema = Joi.object({
            current_password: Joi.string().required(),
            new_password: Joi.string().min(6).required(),
            confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
                .messages({ 'any.only': 'Passwords do not match.' })
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { current_password, new_password } = value;

        const admin = req.admin;
        if (!admin) return handleError(res, 401, "en", "Unauthorized");

        const [user] = await adminModels.findById(admin.admin_id);
        if (!user) return handleError(res, 404, "en", "User not found");

        const isMatch = await bcrypt.compare(current_password, user.password);
        if (!isMatch) return handleError(res, 400, "en", "Incorrect current password");

        const hashedPassword = await bcrypt.hash(new_password, 10);
        await adminModels.updatePassword(admin.admin_id, hashedPassword);

        return handleSuccess(res, 200, "en", "Password changed successfully");
    } catch (error) {
        console.error("Change password error:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const login_with_mobile = async (req, res) => {
    try {
        const sendOtpSchema = Joi.object({
            mobile_number: Joi.string().required(),
            language: Joi.string().valid('sv', 'en').optional().allow("", null),
        });

        const { error, value } = sendOtpSchema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { mobile_number, language } = value;
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        let [user] = await apiModels.get_user_by_mobile_number(mobile_number);

        if (!user) {
            await apiModels.create_user(mobile_number, otp, language);
            [user] = await apiModels.get_user_by_mobile_number(mobile_number);
        }

        if (user && !user.is_active) {
            return handleError(res, 400, language, 'ADMIN_DEACTIVATION');
        }

        let user_data = {
            otp, language
        }

        await apiModels.update_user(user_data, user.user_id);
        return handleSuccess(res, 200, language, "VERIFICATION_OTP", otp);
    } catch (error) {
        console.error("internal E", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const get_all_call_logs = async (req, res) => {
    try {
        const rows = await apiModels.fetchAllCallLogsWithDetails();

        if (!Array.isArray(rows)) {
            throw new Error("rows is not an array");
        }

        const callLogs = rows.map(row => ({
            call_id: row.call_id,
            status: row.status,
            started_at: row.started_at,
            created_at: row.created_at,

            sender: row.su_id
                ? {
                    type: "user",
                    user_id: row.su_id,
                    full_name: row.su_name,
                    mobile_number: row.su_mobile
                }
                : {
                    type: "doctor",
                    doctor_id: row.sd_id,
                    name: row.sd_name,
                    specialization: row.sd_specialization
                },

            receiver: row.ru_id
                ? {
                    type: "user",
                    user_id: row.ru_id,
                    full_name: row.ru_name,
                    mobile_number: row.ru_mobile
                }
                : {
                    type: "doctor",
                    doctor_id: row.rd_id,
                    name: row.rd_name,
                    specialization: row.rd_specialization
                }
        }));

        return handleSuccess(res, 200, 'en', 'Call logs fetched successfully', callLogs);
    } catch (error) {
        console.error('❌ Error fetching call logs:', error);
        return handleError(res, 500, 'en', error.message || 'Something went wrong');
    }
};

export const get_all_appointments = async (req, res) => {
    try {
        await updateMissedAppointmentStatusModel();
        const appointments = await apiModels.get_all_appointments();

        if (!Array.isArray(appointments) || appointments.length === 0) {
            return handleSuccess(res, 200, 'en', "No appointments found",  [] );
        }

        const formatted = appointments.map(row => ({
            appointment_id: row.appointment_id,
            start_time: row.start_time,
            end_time: row.end_time,
            type: row.type,
            status: row.status,
            payment_status: row.payment_status,

            user: {
                user_id: row.user_id,
                full_name: row.user_name,
                mobile_number: row.user_mobile,
                email: row.email,
                age: row.user_age,
                gender: row.gender,
                profile_image: row.user_profile_image ? `${process.env.APP_URL}${row.user_profile_image}` : null,

            },

            doctor: {
                doctor_id: row.doctor_id,
                name: row.doctor_name,
                age: row.doctor_age,
                address: row.doctor_address,
                biography: row.biography,
                experience_years: row.experience_years,
                rating: row.rating,
                phone: row.phone,
                fee_per_session: row.fee_per_session,
                profile_image: row.doctor_image
                    ? process.env.APP_URL + "doctor/profile_images/" + row.doctor_image
                    : null,
            },

            clinic: {
                clinic_id: row.clinic_id,
                clinic_name: row.clinic_name,
                email: row.clinic_email,
                mobile_number: row.clinic_mobile,
                address: row.clinic_address,
            },

            scanReport: {
                face_scan_result_id: row.face_scan_result_id,
                pdf: row.pdf ? process.env.APP_URL + row.pdf : null
            }
        }));

        return handleSuccess(res, 200, 'en', "Appointments fetched successfully", formatted);
    } catch (error) {
        console.error("❌ Error fetching appointments:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const get_single_all_appointments = async (req, res) => {
    try {
        const appointment_id = req.params.appointment_id
        await updateMissedAppointmentStatusModel();
        const appointments = await apiModels.get_single_appointments(appointment_id);

        if (!Array.isArray(appointments) || appointments.length === 0) {
            return handleSuccess(res, 200, 'en', "No appointments found", {});
        }

        const formatted = appointments.map(row => ({
            appointment_id: row.appointment_id,
            start_time: row.start_time,
            end_time: row.end_time,
            type: row.type,
            status: row.status,
            payment_status: row.payment_status,

            user: {
                user_id: row.user_id,
                full_name: row.user_name,
                mobile_number: row.user_mobile,
                email: row.email,
                age: row.user_age,
                gender: row.gender,
                profile_image: row.user_profile_image ? `${process.env.APP_URL}${row.user_profile_image}` : null,

            },

            doctor: {
                doctor_id: row.doctor_id,
                name: row.doctor_name,
                age: row.doctor_age,
                address: row.doctor_address,
                biography: row.biography,
                experience_years: row.experience_years,
                rating: row.rating,
                phone: row.phone,
                fee_per_session: row.fee_per_session,
                profile_image: row.doctor_image
                    ? process.env.APP_URL + "doctor/profile_images/" + row.doctor_image
                    : null,
            },

            clinic: {
                clinic_id: row.clinic_id,
                clinic_name: row.clinic_name,
                email: row.clinic_email,
                mobile_number: row.clinic_mobile,
                address: row.clinic_address,
            },

            scanReport: {
                face_scan_result_id: row.face_scan_result_id,
                pdf: row.pdf ? process.env.APP_URL + row.pdf : null
            }
        }));
        const data = formatted[0] || {};
        return handleSuccess(res, 200, 'en', "Appointments fetched successfully", data);
    } catch (error) {
        console.error("❌ Error fetching appointments:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR " + error.message);
    }
};


export const get_all_enrollments = async (req, res) => {
    try {
        const enrollments = await apiModels.get_all_enrollments();

        return handleSuccess(res, 200, 'en', "Appointments fetched successfully", enrollments);
    } catch (error) {
        console.error("❌ Error fetching appointments:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const cancelAppointment = async (req, res) => {
    try {
        const { appointment_id, reason } = req.body;
        const schema = Joi.object({
            appointment_id: Joi.string().required(),
            reason: Joi.string().required(),
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const admin_id = req.admin.admin_id;


        const appointmentDetails = await adminModels.getAppointmentsById(appointment_id);
        const appointment = appointmentDetails[0]
        if (!appointment) return handleError(res, 404, "en", "APPOINTMENT_NOT_FOUND");



        await appointmentModel.cancelAppointment(appointment_id, {
            status: 'Cancelled',
            cancelled_by: 'admin',
            cancelled_by_id: admin_id,
            cancel_reason: reason,
            payment_status: appointment.is_paid ? 'refund_initiated' : appointment.payment_status
        });

        handleSuccess(res, 200, 'en', 'APPOINTMENT_CANCELLED_SUCCESSFULLY');

        await Promise.all([
            sendNotification(
                {
                    userData: req.user,
                    type: "APPOINTMENT",
                    type_id: appointment_id,
                    notification_type: NOTIFICATION_MESSAGES.appointment_cancelled,
                    receiver_type: "USER",
                    receiver_id: appointment.user_id
                }
            ),
            sendNotification(
                {
                    userData: req.user,
                    type: "APPOINTMENT",
                    type_id: appointment_id,
                    notification_type: NOTIFICATION_MESSAGES.appointment_cancelled,
                    receiver_type: "DOCTOR",
                    receiver_id: appointment.doctor_id
                }
            )
        ])
    } catch (err) {
        console.error(err);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const completeRefundToWallet = async (req, res) => {
    try {
        const schema = Joi.object({
            appointment_id: Joi.string().required(),
            amount: Joi.number().required() // defaults to appointment total_price
        });
        const { error, value } = schema.validate(req.body);
        if (error) return handleError(res, 422, 'en', error.message);

        const { appointment_id, amount } = value;

        const rows = await adminModels.getAppointmentsById(appointment_id);
        const appt = rows?.[0];
        if (!appt) return handleError(res, 404, 'en', 'APPOINTMENT_NOT_FOUND');

        if (appt.payment_status !== 'refund_initiated') {
            return handleError(res, 400, 'en', 'REFUND_NOT_INITIATED');
        }
        const alreadyRefunded = await walletModel.checkAlreadyRefunded(appointment_id);

        if (alreadyRefunded) {
            return handleError(res, 400, 'en', 'REFUND_ALREADY_PAID');
        }

        const refundAmount = Number(amount || appt.total_price);

        // wallet ops
        const wallet = await walletModel.getOrCreateWalletByUserId(appt.user_id);
        await walletModel.adjustBalance(wallet.wallet_id, refundAmount);
        const transaction_id = uuidv4();
        await walletModel.insertWalletTx({
            transaction_id: transaction_id,
            wallet_id: wallet.wallet_id,
            appointment_id: appt.appointment_id,
            amount: refundAmount,
            type: 'refund',
            description: 'Manual refund to wallet for cancelled appointment'
        });

        await walletModel.updatePaymentStatus(appointment_id, 'refund_completed');
        await sendNotification({
            userData: req.user,
            type: "REFUND",
            type_id: appt.appointment_id,
            notification_type: NOTIFICATION_MESSAGES.booking_refunded,
            receiver_type: "USER",
            receiver_id: appt.user_id
        })
        return handleSuccess(res, 200, 'en', 'REFUND_COMPLETED', {
            appointment_id,
            refunded: refundAmount
        });
    } catch (err) {
        console.error('completeRefundToWallet error:', err);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};


export const getRefundHistory = async (req, res) => {
    try {
        const { transactions } = await walletModel.getRefundHistory();

        await Promise.all(transactions.map(async (t) => {
            t.treatments = await appointmentModel.getAppointmentTreatments(t.appointment_id);
            return t;
        }))

        return handleSuccess(res, 200, 'en', 'WALLET_SUMMARY', { transactions });
    } catch (err) {
        console.error('getMyWallet error:', err);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};


export const getUserAppointmentOfUser = async (req, res) => {
    try {

        const schema = Joi.object({
            user_id: Joi.string().required(),
        });
        const { error, value } = schema.validate(req.params);
        if (error) return handleError(res, 422, 'en', error.message);

        const { user_id } = value;
        const appointments = await appointmentModel.getAppointmentsByUserId(user_id, 'booked', 'unpaid');


        const now = dayjs.utc();
        const result = await Promise.all(appointments.map(async (app) => {

            if (app.profile_image && !app.profile_image.startsWith('http')) {
                app.profile_image = `${process.env.APP_URL}doctor/profile_images/${app.profile_image}`;
            }

            if (app.pdf && !app.pdf.startsWith('http')) {
                app.pdf = `${process.env.APP_URL}${app.pdf}`;
            }

            const startUTC = app.start_time ? dayjs.utc(app.start_time) : null;
            const endUTC = app.end_time ? dayjs.utc(app.end_time) : null;


            const treatments = await appointmentModel.getAppointmentTreatments(app.appointment_id);

            return {
                ...app,
                start_time: startUTC ? startUTC.toISOString() : null,
                end_time: endUTC ? endUTC.toISOString() : null,
                treatments
            };
        }));


        return handleSuccess(res, 200, "en", "APPOINTMENTS_FETCHED", result);
    } catch (error) {
        console.error("Error fetching user appointments:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const searchLocation = async (req, res) => {
    try {
        const schema = Joi.object({
            input: Joi.string().required(),
        });

        const { error, value } = schema.validate(req.query);
        if (error) return joiErrorHandle(res, error);

        const { input } = value;
        const googleApiKey = process.env.GOOGLE_API_KEY;
        const apiUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?key=${googleApiKey}&input=${input}`;

        const response = await axios.get(apiUrl);
        return handleSuccess(
            res,
            200,
            "en",
            "LOCATION_SEARCH_SUCCESS",
            response.data.predictions
        );
    } catch (error) {
        console.error("Error in searchLocationRequest:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const getLatLong = (req, res) => {
    return new Promise(async (resolve, reject) => {
        try {
            const { address } = req.query;
            const googleApiKey = process.env.GOOGLE_API_KEY;
            const apiUrl = "https://maps.googleapis.com/maps/api/geocode/json";
            const response = await axios.get(apiUrl, {
                params: {
                    address,
                    key: googleApiKey,
                },
            });
            const { results } = response.data;
            if (results && results.length > 0) {
                const { lat, lng } = results[0].geometry.location;
                let data = {
                    lat,
                    lng,
                };
                return handleSuccess(
                    res,
                    200,
                    "en",
                    "LAT_LONG_FETCHED_SUCCESSFULLY",
                    data
                );
            } else {
                return handleError(res, 404, "en", "NO_RESULT_FOUND");
            }
        } catch (error) {
            handleError(res, 500, "en", error.message);
            reject(error);
        }
    });
};