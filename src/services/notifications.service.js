// ============================================================================
// IMPORTS & INITIAL SETUP
// ============================================================================
import db from '../config/db.js';
import { validateSchema } from '../middleware/validation.middleware.js';
import { getAppointmentsForNotification } from '../models/appointment.js';
import { getUserDataByReceiverIdAndRole, getUserDataByRole } from '../models/web_user.js';
import { extractUserData, translateText } from '../utils/misc.util.js';
import { isEmpty } from '../utils/user_helper.js';
import { sendNotificationSchema } from '../validations/notification.validation.js';
import admin from 'firebase-admin';
import fs from "fs";
import dayjs from 'dayjs';
import dotenv from "dotenv";
dotenv.config();
import path from "path";
import { fileURLToPath } from 'url';
import { getUserLanguageModel, getZynqUserLanguageModel } from '../models/admin.js';
// __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ============================================================================
// HELPERS
// ============================================================================

const buildFullImageUrl = (senderType, imageFileName) => {
    if (!imageFileName) return null;

    const baseUrl = process.env.APP_URL;

    switch (senderType) {
        case "DOCTOR":
        case "SOLO_DOCTOR":
            return `${baseUrl}doctor/profile_images/${imageFileName}`;
        case "CLINIC":
            return `${baseUrl}clinic/logo/${imageFileName}`;
        case "USER":
        case "ADMIN":
            return `${baseUrl}${imageFileName}`;
        default:
            return null;
    }
};

// ============================================================================
// TEMPLATES
// ============================================================================
export const NOTIFICATION_MESSAGES = {
    chat_message: {
        title: 'Chat Notification',
        getBody: (name) => `${name} sent you a message.`
    },
    appointment_booked: {
        title: 'Appointment',
        getBody: (name) => `${name} booked an appointment.`
    },
    payment_success_booking_confirmed: {
        title: 'Payment Successful',
        getBody: () =>
            `Your payment was successful and your appointment is confirmed.`,
    },
    payment_failed_pay_later: {
        title: 'Payment Failed',
        getBody: (reason) =>
            `Your payment failed${reason ? ` due to ${reason}` : ' due to insufficient funds'}. Your appointment has been cancelled.`,
    },
    appointment_rescheduled: {
        title: 'Appointment',
        getBody: (name) => `${name} rescheduled an appointment.`
    },
    appointment_completed: {
        title: 'Appointment',
        getBody: (name) => `${name} completed an appointment.`
    },
    upcoming_appointment: {
        title: 'Upcoming Appointment',
        getBody: (name) => `You have an upcoming appointment with ${name}.`
    },
    callback_requested: {
        title: 'Callback Request',
        getBody: (name) => `${name} requested a callback.`
    },
    cart_purchased: {
        title: 'Order Placed',
        getBody: (name) => ` ${name} has placed an order`
    },
    cart_purchased_user: {
        title: 'Order Placed',
        getBody: () => `Order has been successfully placed`
    },
    appointment_cancelled: {
        title: 'Appointment Cancelled',
        getBody: (name) => `${name} cancelled an appointment.`
    },
    shipment_shipped: {
        title: 'Shipment Shipped',
        getBody: (name) => `${name} has shipped the order`
    },
    shipment_delivered: {
        title: 'Shipment Delivered',
        getBody: (name) => `${name} has delivered the order`
    },
    booking_refunded: {
        title: 'Booking Refunded',
        getBody: () => `Your booking has been refunded`
    },
    appointment_rating_approved: {
        title: 'Appointment Rating Approved',
        getBody: () => `Your rating has been approved.`
    },
    appointment_rating_rejected: {
        title: 'Appointment Rating Rejected',
        getBody: () => `Your rating has been rejected.`
    },
    doctor_review: {
        title: 'New Review',
        getBody: () => `You have a new review.`
    },
    support_ticket_response: {
        title: 'Support Ticket Response',
        getBody: () => `You have a new support ticket response.`
    },
    user_pending: {
        title: 'Profile Status',
        getBody: () => `Your profile is pending for approval by administrator.`
    },
    user_rejected: {
        title: 'Profile Status',
        getBody: () => `Your profile has been rejected by administrator.`
    },
    user_approved: {
        title: 'Profile Status',
        getBody: () => `Your profile has been approved by administrator.`
    },
    user_verified: {
        title: 'Profile Status',
        getBody: () => `Your profile has been verified by administrator.`
    },
    product_approved: {
        title: 'Product Approved',
        getBody: () => `Your product has been approved by administrator.`
    },
    product_rejected: {
        title: 'Product Rejected',
        getBody: () => `Your product has been rejected by administrator.`
    },
    treatment_approved: {
        title: 'Service Approved',
        getBody: () => `Your Service has been approved by administrator.`
    },
    treatment_rejected: {
        title: 'Service Rejected',
        getBody: () => `Your Service has been rejected by administrator.`
    },
    concern_approved: {
        title: 'Concern Approved',
        getBody: () => `Your concern has been approved by administrator.`
    },
    concern_rejected: {
        title: 'Concern Rejected',
        getBody: () => `Your concern has been rejected by administrator.`
    },
    default: {
        title: (name) => `${name} Notification`,
        getBody: () => `You have a new notification.`
    },
    customMessage: (title = 'Notification', body = 'You have a custom notification.') => ({
        title,
        getBody: () => body,
        isCustom: true
    })
};

const getNotificationContent = async (notification_type, full_name) => {
    let template;

    if (typeof notification_type === 'object' && typeof notification_type.getBody === 'function') {
        template = notification_type;
    } else {
        template = NOTIFICATION_MESSAGES[notification_type] || NOTIFICATION_MESSAGES.default;
    }

    const title = typeof template.title === 'function'
        ? template.title(full_name)
        : template.title;

    const body = template.getBody(full_name);

    // Translate to Swedish
    const title_sv = await translateText(title, 'sv');
    const body_sv = await translateText(body, 'sv');

    return { title, body, title_sv, body_sv };
};

// ============================================================================
// FCM NOTIFICATION SENDER
// ============================================================================

if (!admin.apps.length) {
    const serviceAccountPath = path.resolve(__dirname, `../../${process.env.FIREBASE_SERVICE_ACCOUNT}`);
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const isPushNotificationEnabled = async (receiver_id, receiver_type) => {
    let query = '';

    switch (receiver_type) {
        case 'USER':
            query = 'SELECT is_push_notification_on FROM tbl_users WHERE user_id = ?';
            break;

        // case 'DOCTOR':
        //   query = 'SELECT is_push_notification_on FROM tbl_doctors WHERE doctor_id = ?';
        //   break;

        default:
            return true;
    }

    try {
        const result = await db.query(query, [receiver_id]);
        return Boolean(result[0]?.is_push_notification_on);

    } catch (error) {
        console.error('Error checking push notification status:', error);
        return false;
    }
};


const buildNotificationPayload = ({
    type,
    type_id,
    sender_id,
    sender_type,
    receiver_id,
    receiver_type,
    token,
    title,
    body
}) => ({
    notification: { title, body },
    data: {
        sendFrom: String(sender_id || ''),
        sendTo: String(receiver_id || ''),
        senderType: sender_type,
        receiverType: receiver_type,
        type,
        type_id,
    },
    token: token || ''
});

const pushToFCM = async (message) => {
    try {
        const response = await admin.messaging().send({
            token: message.token,
            notification: message.notification,
            data: message.data
        });
        return response;
    } catch (error) {
        console.error('FCM Error - pushToFCM:', error);
        throw new Error('Failed to send push notification');
    }
};

// ============================================================================
// SEND NOTIFICATION WRAPPER
// ============================================================================
const insertUserNotification = async ({
    sender_id = null,
    sender_type = null,
    receiver_id,
    receiver_type,
    type,
    type_id = null,
    title,
    body,
    title_sv,
    body_sv
}) => {
    try {
        const result = await db.query(
            `INSERT INTO tbl_notifications 
             (sender_id, sender_type, receiver_id, receiver_type, type, type_id, title, body, title_sv, body_sv) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                sender_id,
                sender_type,
                receiver_id,
                receiver_type,
                type,
                type_id,
                title,
                body,
                title_sv,
                body_sv
            ]
        );
        return result;
    } catch (error) {
        console.error('DB Error - insertUserNotification:', error);
        throw new Error('Failed to insert notification');
    }
};

/**
 * Sends a notification, stores it in the DB, and optionally pushes via FCM.
 */
export const sendNotification = async ({
    userData,
    type,
    type_id,
    notification_type,
    receiver_type,
    receiver_id,
    system = false,
    receiver_fcm_token = null,
    receiver_push_enabled = null,
    params = null,
}) => {
    try {
        validateSchema(sendNotificationSchema, {
            userData,
            type,
            type_id,
            notification_type,
            receiver_type,
            receiver_id,
            system,
        });
        const senderMeta = system ? userData : extractUserData(userData);

        const {
            user_id: sender_id,
            role: sender_type,
        } = senderMeta;

        const full_name = params ? params : isEmpty(senderMeta?.full_name) ? 'Someone' : senderMeta?.full_name;
        let language = 'en';

        if (receiver_type === 'USER') {
            const [data] = await getUserLanguageModel(receiver_id);
            language = data?.language || 'en';
        } else if (receiver_type === 'ADMIN') {
            language = 'en';
        } else {
            const [data] = await getUserLanguageModel(receiver_id);
            language = data?.language || 'en';
        }


        const { title, body, title_sv, body_sv } = await getNotificationContent(notification_type, full_name);

        const isPushEnabled = receiver_type === 'USER'
            ? (receiver_push_enabled ?? await isPushNotificationEnabled(receiver_id, receiver_type))
            : true;

        const token = receiver_fcm_token || (await getUserDataByReceiverIdAndRole(receiver_id, receiver_type))?.token;

        const payload = buildNotificationPayload({
            type,
            type_id,
            sender_id,
            sender_type,
            receiver_id,
            receiver_type,
            token,
            title: language === 'sv' ? title_sv : title,
            body: language === 'sv' ? body_sv : body
        });

        const dbPromise = insertUserNotification({
            sender_id,
            sender_type,
            receiver_id,
            receiver_type,
            type,
            type_id,
            title,
            body,
            title_sv,
            body_sv
        }).then(() => console.log("✅ Notification recorded in DB"));

        const fcmPromise = (token && isPushEnabled)
            ? pushToFCM(payload).then(() => console.log("✅ Notification sent via FCM"))
            : Promise.resolve();

        await Promise.all([dbPromise, fcmPromise]);

    } catch (error) {
        console.error('Error in sendNotification:', error);
        // throw error;
    }
};

// ============================================================================
// FETCH USER NOTIFICATIONS
// ============================================================================
const groupSenderIdsByType = (notifications) => {
    const senderMap = new Map();
    for (const notification of notifications) {
        if (!senderMap.has(notification.sender_type)) {
            senderMap.set(notification.sender_type, new Set());
        }
        senderMap.get(notification.sender_type).add(notification.sender_id);
    }
    return senderMap;
};

const fetchSenderDetailsByType = async (senderMap) => {
    const senderDetails = {};

    const queries = Array.from(senderMap.entries()).map(async ([type, ids]) => {
        const idList = Array.from(ids);
        if (idList.length === 0) return;

        let table, idCol, nameCol = "name", imageCol = "profile_image";

        switch (type) {
            case "USER":
                table = "tbl_users";
                idCol = "user_id";
                nameCol = "full_name";
                imageCol = "profile_image";
                break;
            case "DOCTOR":
            case "SOLO_DOCTOR":
                table = "tbl_doctors";
                idCol = "doctor_id";
                nameCol = "name";
                imageCol = "profile_image";
                break;
            case "CLINIC":
                table = "tbl_clinics";
                idCol = "clinic_id";
                nameCol = "clinic_name";
                imageCol = "clinic_logo";
                break;
            case "ADMIN":
                table = "tbl_admin";
                idCol = "admin_id";
                nameCol = "full_name";
                imageCol = "profile_image";
                break;
            default:
                return;
        }

        const rows = await db.query(
            `SELECT ${idCol} AS sender_id, ${nameCol} AS sender_name, ${imageCol} AS sender_profile_image
             FROM ${table}
             WHERE ${idCol} IN (?)`,
            [idList]
        );

        return { type, rows };
    });

    const results = await Promise.all(queries);

    for (const result of results) {
        if (!result) continue;
        const { type, rows } = result;
        for (const row of rows) {
            senderDetails[`${type}:${row.sender_id}`] = {
                sender_name: row.sender_name,
                sender_profile_image: buildFullImageUrl(type, row.sender_profile_image),
            };
        }
    }

    return senderDetails;
};

const enrichNotifications = (notifications, senderDetails) => {
    return notifications.map(n => ({
        ...n,
        ...(senderDetails[`${n.sender_type}:${n.sender_id}`] || {
            sender_name: null,
            sender_profile_image: null
        })
    }));
};

export const getUserNotifications = async (userData, language) => {
    try {
        const { user_id: receiver_id } = extractUserData(userData);

        const notifications = await db.query(
            `SELECT * FROM tbl_notifications
             WHERE receiver_id = ?
             ORDER BY created_at DESC`,
            [receiver_id]
        );

        if (notifications.length === 0) return [];

        const senderMap = groupSenderIdsByType(notifications);
        const senderDetails = await fetchSenderDetailsByType(senderMap);
        const enrichedNotifications = enrichNotifications(notifications, senderDetails);

        const notificationsWithLanguage = enrichedNotifications.map(n => ({
            ...n,
            title: language === 'sv' ? n.title_sv : n.title,
            body: language === 'sv' ? n.body_sv : n.body,
            appointment_id: n.type === 'APPOINTMENT' ? n.type_id : null
        }))

        return notificationsWithLanguage;

    } catch (error) {
        console.error('Error in getUserNotifications:', error);
        throw new Error('Failed to fetch notifications');
    }
};


// ============================================================================
// TOGGLE NOTIFICATIONS
// ============================================================================

export const toggleNotificationSetting = async (userData) => {
    try {
        const { user_id, role } = extractUserData(userData);

        let updateQuery = '';
        switch (role) {
            case 'USER':
                updateQuery = 'UPDATE tbl_users SET is_push_notification_on = NOT is_push_notification_on WHERE user_id = ?';
                break;
            default:
                return { affectedRows: 0 };
        }

        return await db.query(updateQuery, [user_id]);
    } catch (error) {
        console.error('Error in toggleNotificationSetting:', error);
        throw new Error('Failed to toggle notification setting');

    }
};

// ============================================================================
// Delete NOTIFICATIONS
// ============================================================================

export const deleteSingleNotificationModel = async (userData, notification_id) => {
    try {
        const { user_id: receiver_id } = extractUserData(userData);

        const deleteNotification = await db.query(
            `DELETE FROM tbl_notifications
             WHERE receiver_id = ? AND notification_id = ?`,
            [receiver_id, notification_id]
        );

    } catch (error) {
        console.error('Error in DeleteSingleNotification:', error);
        throw new Error('Failed to delete notification');
    }
};

export const deleteNotificationsModel = async (userData) => {
    try {
        const { user_id: receiver_id } = extractUserData(userData);

        const deleteNotification = await db.query(
            `DELETE FROM tbl_notifications
             WHERE receiver_id = ?`,
            [receiver_id]
        );

    } catch (error) {
        console.error('Error in DeleteNotifications:', error);
        throw new Error('Failed to delete notifications');
    }
};

// ============================================================================
// Appointment Notifications CRON
// ============================================================================

export const getUpcomingAppointmentWindow = (minutesFromNow = 30) => {
    const now = dayjs().utc();
    return {
        windowStart: now.startOf('minute').format('YYYY-MM-DD HH:mm:ss'),
        windowEnd: now.add(minutesFromNow, 'minute').endOf('minute').format('YYYY-MM-DD HH:mm:ss')
    };
};

export const sendAppointmentPairNotification = (appointment) => {
    const { appointment_id, user_id, doctor_id, user_name, user_fcm_token, user_push_notification_on, doctor_name, doctor_fcm_token } = appointment;

    return [
        sendNotification({
            userData: { user_id: doctor_id, role: 'DOCTOR', full_name: doctor_name || 'Doctor', },
            type: 'APPOINTMENT',
            type_id: appointment_id,
            notification_type: NOTIFICATION_MESSAGES.upcoming_appointment,
            receiver_type: 'USER',
            receiver_id: user_id,
            system: true,
            receiver_fcm_token: user_fcm_token,
            receiver_push_enabled: user_push_notification_on

        }),
        sendNotification({
            userData: { user_id, role: 'USER', full_name: user_name || 'Someone', },
            type: 'APPOINTMENT',
            type_id: appointment_id,
            notification_type: NOTIFICATION_MESSAGES.upcoming_appointment,
            receiver_type: 'DOCTOR',
            receiver_id: doctor_id,
            system: true,
            receiver_fcm_token: doctor_fcm_token
        })
    ];
};

export const bulkMarkAppointmentReminders = async (appointments24h, appointments1h) => {
    if (!appointments24h.length && !appointments1h.length) return;

    const sets = [];

    if (appointments24h.length) {
        sets.push(`
            reminder_24h_sent = CASE appointment_id
                ${appointments24h.map(id => `WHEN '${id}' THEN 1`).join(' ')}
                ELSE reminder_24h_sent
            END
        `);
    }

    if (appointments1h.length) {
        sets.push(`
            reminder_1h_sent = CASE appointment_id
                ${appointments1h.map(id => `WHEN '${id}' THEN 1`).join(' ')}
                ELSE reminder_1h_sent
            END
        `);
    }

    const allIds = [...appointments24h, ...appointments1h];

    const sql = `
        UPDATE tbl_appointments
        SET ${sets.join(', ')}
        WHERE appointment_id IN (${allIds.map(id => `'${id}'`).join(',')});
    `;

    await db.query(sql);
};

export const sendAppointmentNotifications = async () => {
    try {
        const MINUTES_24H = 24 * 60;
        const MINUTES_1H = 60;
        const DB_BUFFER = 15;
        const SEND_WINDOW = 10;

        const { windowStart, windowEnd } = getUpcomingAppointmentWindow(MINUTES_24H + DB_BUFFER);
        const appointments = await getAppointmentsForNotification(windowStart, windowEnd);

        if (!appointments.length) return console.log('No appointments found for notification.');

        const now = dayjs().utc();
        const appointments24h = [];
        const appointments1h = [];
        const notificationPromises = [];

        appointments.forEach((appt) => {
            const startTime = dayjs(appt.start_time);
            const diffMinutes = startTime.diff(now, 'minutes');

            const is24hReminder = !appt.reminder_24h_sent &&
                diffMinutes >= MINUTES_24H - SEND_WINDOW &&
                diffMinutes <= MINUTES_24H + SEND_WINDOW;

            const is1hReminder = !appt.reminder_1h_sent &&
                diffMinutes >= MINUTES_1H - SEND_WINDOW &&
                diffMinutes <= MINUTES_1H + SEND_WINDOW;

            if (is24hReminder) {
                appointments24h.push(appt.appointment_id);
                notificationPromises.push(sendAppointmentPairNotification(appt));
            } else if (is1hReminder) {
                appointments1h.push(appt.appointment_id);
                notificationPromises.push(sendAppointmentPairNotification(appt));
            }
        });

        await Promise.all([
            ...notificationPromises,
            bulkMarkAppointmentReminders(appointments24h, appointments1h)
        ]);
    } catch (error) {
        console.error('❌ Cron job failed:', error.message);
    }
};
