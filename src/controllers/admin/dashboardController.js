import { get_clinics, get_doctors, get_users, get_latest_clinic, getAdminBookedAppointmentsModel, getAdminReviewsModel, getAdminPurchasedProductModel, getAdminCartProductModel, getAdminCommissionRatesModel, updateAdminCommissionRatesModel, getSingleAdminPurchasedProductModel, getSingleAdminCartProductModel, get_admin_earning, addWalletAmountModel, updateRatingStatusModel, updateOrderModel, updateWalletHistoryModel, checkExistingWalletHistoryModel } from '../../models/admin.js';
import { get_product_images_by_product_ids } from '../../models/api.js';
import { getClinicDoctorWallets } from '../../models/payment.js';
import { NOTIFICATION_MESSAGES, sendNotification } from '../../services/notifications.service.js';
import { asyncHandler, handleError, handleSuccess } from '../../utils/responseHandler.js';
import { groupProductsByCartAndClinic } from '../api/productController.js';
const APP_URL = process.env.APP_URL;
export const get_dashboard = async (req, res) => {
    try {
        const [get_clinic, get_doctor, get_user, latest_clinic, admin_earnings] = await Promise.all([
            get_clinics(),
            get_doctors(),
            get_users(),
            get_latest_clinic(),
            get_admin_earning(),
        ])

        const data = {
            get_clinics: get_clinic.length,
            get_doctors: get_doctor.length,
            get_users: get_user.length,
            get_earnings: parseFloat(admin_earnings.total_admin_earnings),
            total_platform_earnings: parseFloat(admin_earnings.total_platform_earnings),
            total_purchases: parseInt(admin_earnings.total_purchases),
            total_refunds: parseFloat(admin_earnings.total_refunds),
            latest_clinic
        }

        return handleSuccess(res, 200, "en", "Get dashboard data retriev", data);
    } catch (error) {
        console.error("Failed dashboard:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const get_wallets = asyncHandler(async (req, res) => {
    const wallets = await getClinicDoctorWallets();
    return handleSuccess(res, 200, 'en', "WALLETS_FETCHED", wallets);
})

export const getBookedAppointments = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const appointments = await getAdminBookedAppointmentsModel();

    const processedAppointments = appointments.map(appt => {
        const isCancelledOrRefunded = appt.status === 'Cancelled' || ['unpaid', 'failed', 'refund_completed', 'refund_initiated'].includes(appt.payment_status);
        return {
            ...appt,
            admin_earnings: isCancelledOrRefunded ? 0.00 : Number(appt.admin_earnings) || 0,
            clinic_earnings: isCancelledOrRefunded ? 0.00 : Number(appt.clinic_earnings) || 0,
            total_price: isCancelledOrRefunded ? 0.00 : Number(appt.total_price) || 0
        };
    });

    const {
        total_clinic_earnings,
        total_admin_earnings,
        total_appointments_earnings
    } = processedAppointments.reduce(
        (acc, appointment) => {
            acc.total_clinic_earnings += appointment.clinic_earnings;
            acc.total_admin_earnings += appointment.admin_earnings;
            acc.total_appointments_earnings += appointment.total_price;
            return acc;
        },
        {
            total_clinic_earnings: 0,
            total_admin_earnings: 0,
            total_appointments_earnings: 0
        }
    );

    const data = {
        total_clinic_earnings: Number(total_clinic_earnings.toFixed(2)),
        total_admin_earnings: Number(total_admin_earnings.toFixed(2)),
        total_appointments_earnings: Number(total_appointments_earnings.toFixed(2)),
        appointments: processedAppointments,
    }
    return handleSuccess(res, 200, language, "APPOINTMENTS_FETCHED", data);
});

export const getPurchasedProducts = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';

    // 1️⃣ Fetch purchases with enriched products (including live stock and images)
    const purchases = await getAdminPurchasedProductModel();

    // 2️⃣ Fetch cart earnings info
    const carts = await getAdminCartProductModel();

    // 3️⃣ Calculate totals
    const {
        total_clinic_earnings,
        total_admin_earnings,
        total_carts_earnings
    } = carts.reduce(
        (acc, cart) => {
            acc.total_clinic_earnings += Number(cart.clinic_earnings) || 0;
            acc.total_admin_earnings += Number(cart.admin_earnings) || 0;
            acc.total_carts_earnings += Number(cart.total_price) || 0;
            return acc;
        },
        {
            total_clinic_earnings: 0,
            total_admin_earnings: 0,
            total_carts_earnings: 0
        }
    );

    // 4️⃣ Send response
    const data = {
        total_clinic_earnings: Number(total_clinic_earnings.toFixed(2)),
        total_admin_earnings: Number(total_admin_earnings.toFixed(2)),
        total_carts_earnings: Number(total_carts_earnings.toFixed(2)),
        purchases,  // renamed for clarity
    };

    return handleSuccess(res, 200, language, "PURCHASED_PRODUCTS_FETCHED", data);
});

export const getSinglePurchasedProducts = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';

    const purchase_id = req.params.purchase_id

    // 1️⃣ Fetch purchases with enriched products (including live stock and images)
    const purchases = await getSingleAdminPurchasedProductModel(purchase_id);

    // 2️⃣ Fetch cart earnings info
    const carts = await getSingleAdminCartProductModel(purchase_id);

    // 3️⃣ Calculate totals
    const {
        total_clinic_earnings,
        total_admin_earnings,
        total_carts_earnings
    } = carts.reduce(
        (acc, cart) => {
            acc.total_clinic_earnings += Number(cart.clinic_earnings) || 0;
            acc.total_admin_earnings += Number(cart.admin_earnings) || 0;
            acc.total_carts_earnings += Number(cart.total_price) || 0;
            return acc;
        },
        {
            total_clinic_earnings: 0,
            total_admin_earnings: 0,
            total_carts_earnings: 0
        }
    );

    // 4️⃣ Send response
    const data = {
        total_clinic_earnings: Number(total_clinic_earnings.toFixed(2)),
        total_admin_earnings: Number(total_admin_earnings.toFixed(2)),
        total_carts_earnings: Number(total_carts_earnings.toFixed(2)),
        purchases,  // renamed for clarity
    };

    return handleSuccess(res, 200, language, "PURCHASED_PRODUCTS_FETCHED", data);
});

export const getPaymentHistory = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const { page, limit } = req.query;

    const [
        purchases,
        appointments
    ] = await Promise.all([
        getAdminPurchasedProductModel(),
        getAdminBookedAppointmentsModel()
    ])

    const data = {
        products: purchases,
        appointments: appointments
    }

    return handleSuccess(res, 200, language, "PURCHASED_PRODUCTS_FETCHED", data);
});

export const getEarnings = asyncHandler(async (req, res) => {
    const language = req?.user?.language || "en";

    const [
        purchases,
        appointments
    ] = await Promise.all([
        getAdminPurchasedProductModel(),
        getAdminBookedAppointmentsModel()
    ])

    const processedAppointments = appointments.map(appt => {
        const isCancelledOrRefunded = appt.status === 'Cancelled' || ['unpaid', 'failed', 'refund_completed', 'refund_initiated'].includes(appt.payment_status);
        return {
            ...appt,
            admin_earnings: isCancelledOrRefunded ? 0.00 : Number(appt.admin_earnings) || 0,
            clinic_earnings: isCancelledOrRefunded ? 0.00 : Number(appt.clinic_earnings) || 0,
            total_price: isCancelledOrRefunded ? 0.00 : Number(appt.total_price) || 0
        };
    });

    const {
        total_doctor_earnings: total_appointment_doctor_earnings,
        total_admin_earnings: total_appointment_admin_earnings,
        total_earnings: total_appointment_earnings
    } = processedAppointments.reduce(
        (acc, appointment) => {
            acc.total_doctor_earnings += appointment.clinic_earnings;
            acc.total_admin_earnings += appointment.admin_earnings;
            acc.total_earnings += appointment.total_price;
            return acc;
        },
        {
            total_doctor_earnings: 0,
            total_admin_earnings: 0,
            total_earnings: 0
        }
    );

    const {
        total_clinic_earnings: total_product_clinic_earnings,
        total_admin_earnings: total_product_admin_earnings,
        total_earnings: total_product_earnings
    } = purchases.reduce(
        (acc, cart) => {
            acc.total_clinic_earnings += Number(cart.clinic_earnings) || 0;
            acc.total_admin_earnings += Number(cart.admin_earnings) || 0;
            acc.total_earnings += Number(cart.total_price) || 0;
            return acc;
        },
        {
            total_clinic_earnings: 0,
            total_admin_earnings: 0,
            total_earnings: 0
        }
    );

    const data = {
        // Appointments
        total_appointment_earnings: Number(total_appointment_earnings.toFixed(2)),
        total_appointment_admin_earnings: Number(total_appointment_admin_earnings.toFixed(2)),
        total_appointment_doctor_earnings: Number(total_appointment_doctor_earnings.toFixed(2)),

        // Products
        total_product_earnings: Number(total_product_earnings.toFixed(2)),
        total_product_admin_earnings: Number(total_product_admin_earnings.toFixed(2)),
        total_product_clinic_earnings: Number(total_product_clinic_earnings.toFixed(2)),

        total_admin_earnings: Number((total_appointment_admin_earnings + total_product_admin_earnings).toFixed(2)),
        total_platform_earnings: Number((total_appointment_earnings + total_product_earnings).toFixed(2)),
        appointments: processedAppointments,
        purchases
    };

    return handleSuccess(res, 200, language, "EARNINGS_FETCHED", data);
});

export const getAdminReviewsRatings = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const reviews = await getAdminReviewsModel();
    return handleSuccess(res, 200, language, "REVIEWS_FETCHED", reviews);
})

export const getAdminCommissionRates = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const commissionRates = await getAdminCommissionRatesModel();
    return handleSuccess(res, 200, language, "COMMISSION_RATES_FETCHED", commissionRates[0]);
})

export const updateAdminCommissionRates = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const { APPOINTMENT_COMMISSION, PRODUCT_COMMISSION } = req.body;
    await updateAdminCommissionRatesModel({ APPOINTMENT_COMMISSION, PRODUCT_COMMISSION });
    return handleSuccess(res, 200, language, "COMMISSION_RATES_UPDATED",);
})

export const addWalletAmount = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const { user_id, user_type, amount, order_type, order_id } = req.body;
    const [checkExistingWalletHistory] = await checkExistingWalletHistoryModel(order_type, order_id);

    if (checkExistingWalletHistory) {
        return handleError(res, 400, language, "WALLET_AMOUNT_ALREADY_ADDED");
    }
    const wallet_id = await addWalletAmountModel(user_id, user_type, amount);

    handleSuccess(res, 200, language, "WALLET_AMOUNT_ADDED",);
    await updateWalletHistoryModel(wallet_id, amount, order_type, order_id);
    await updateOrderModel(order_type, order_id);
})

export const updateRatingStatus = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const { appointment_rating_id, approval_status } = req.body;

    const [{ user_id, appointment_id, doctor_id }] = await updateRatingStatusModel(appointment_rating_id, approval_status);

    const message_type = approval_status === "APPROVED" ? "appointment_rating_approved" : "appointment_rating_rejected";
    const success_message = approval_status === "APPROVED" ? "RATING_APPROVED_SUCCESSFULLY" : "RATING_REJECTED_SUCCESSFULLY";
    const userData = req.user;

    const notifications = [
        sendNotification({
            userData,
            type: "REVIEW",
            type_id: doctor_id,
            notification_type: NOTIFICATION_MESSAGES[message_type],
            receiver_id: user_id,
            receiver_type: "USER"
        })
    ];

    if (approval_status === "APPROVED") {
        notifications.push(
            sendNotification({
                userData,
                type: "REVIEW",
                type_id: user_id,
                notification_type: NOTIFICATION_MESSAGES.doctor_review,
                receiver_id: doctor_id,
                receiver_type: "DOCTOR"
            })
        );
    }

    handleSuccess(res, 200, language, success_message,);
    await Promise.all(notifications);
});