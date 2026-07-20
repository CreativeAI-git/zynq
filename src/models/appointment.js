import db from "../config/db.js";
import dayjs from 'dayjs';
import { formatImagePath } from "../utils/user_helper.js";
import { extractUserData } from "../utils/misc.util.js";

const safeDate = (date) => {
    return date && dayjs(date).isValid() ? dayjs.utc(date).toISOString() : null;
};

export const insertAppointment = async (appointmentData) => {
    try {
        return await db.query(`INSERT INTO tbl_appointments SET ?`, appointmentData);
    } catch (error) {
        console.error("Database Error in insertAppointment:", error.message);
        throw error;
    }
};

export const checkIfSlotAlreadyBooked = async (doctor_id, start_time) => {
    try {
        const result = await db.query(`
            SELECT appointment_id, start_time FROM tbl_appointments
            WHERE doctor_id = ? AND  start_time = ?
        `, [doctor_id, start_time]);
        return result;
    } catch (error) {
        console.error("Database Error in checkIfSlotAlreadyBooked:", error.message);
        throw error;
    }
};

export const getAppointmentsByUserId = async (user_id, status, payment_status) => {
    let results = await db.query(`
    SELECT 
      d.*, 
      a.*, 
      zu.email, 
      r.pdf, 
      c.clinic_name 
    FROM tbl_appointments a 
    LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
    LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id 
    LEFT JOIN tbl_face_scan_results r ON r.face_scan_result_id = a.report_id 
    LEFT JOIN tbl_clinics c ON c.clinic_id = a.clinic_id
    WHERE a.user_id = ? 
      AND a.save_type = ? 
      AND a.payment_status != ?
    ORDER BY    
    CASE 
    WHEN a.end_time >= NOW() THEN 0   
    ELSE 1                            
  END,
  a.end_time ASC;
  `, [user_id, status, payment_status]);

    return results.map(row => {
        const cleanRow = { ...row };
        if ('embeddings' in cleanRow) delete cleanRow.embeddings;
        return cleanRow;
    });;
};


export const getAppointmentsByUserIdV2 = async (user_id, status, payment_status) => {
    const results = await db.query(` 
        SELECT 
        a.*,d.*,zu.email,r.pdf,c.clinic_name 
        FROM tbl_appointments a 
        LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
        LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id 
        LEFT JOIN tbl_face_scan_results r ON r.face_scan_result_id  = a.report_id 
        LEFT JOIN tbl_clinics c ON c.clinic_id  = a.clinic_id
        WHERE a.user_id = ? AND save_type  = ? AND payment_status = ?
        ORDER BY  start_time ASC 
    `, [user_id, status, payment_status]);
    return results.map(row => {
        if ('embeddings' in row) {
            delete row.embeddings;
        }
        return row;
    });
};

export const getDraftAppointmentsByDoctorId = async (appointment_id, doctor_id, status, payment_status) => {
    const results = await db.query(` 
        SELECT 
        a.*,d.*,zu.email,r.pdf,c.clinic_name 
        FROM tbl_appointments a 
        LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
        LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id 
        LEFT JOIN tbl_face_scan_results r ON r.face_scan_result_id  = a.report_id 
        LEFT JOIN tbl_clinics c ON c.clinic_id  = a.clinic_id
        WHERE a.appointment_id = ? AND a.doctor_id = ? AND save_type  = ? AND payment_status = ?
        ORDER BY  start_time ASC 
    `, [appointment_id, doctor_id, status, payment_status]);
    return results.map(row => {
        if ('embeddings' in row) {
            delete row.embeddings;
        }
        return row;
    });
};

export const getBookedAppointmentsByUserId = async (user_id, status) => {
    const results = await db.query(` 
        SELECT a.*,d.*,zu.email,r.pdf,c.clinic_name FROM tbl_appointments a INNER JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
        INNER JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id LEFT JOIN tbl_face_scan_results r ON r.face_scan_result_id  = a.report_id 
        INNER JOIN tbl_clinics c ON c.clinic_id  = a.clinic_id
        WHERE a.user_id = ? AND save_type  = ? AND a.total_price > 0 And a.payment_status != 'unpaid'
        ORDER BY a.created_at DESC
    `, [user_id, status]);
    return results;
};

export const getAppointmentsByDoctorId = async (doctor_id, type) => {
    const results = await db.query(`
        SELECT a.*, u.* , c.clinic_name FROM tbl_appointments a INNER JOIN tbl_users u ON a.user_id = u.user_id  INNER JOIN tbl_clinics c ON a.clinic_id = c.clinic_id 
        WHERE a.doctor_id = ? AND save_type  = ? AND a.payment_status != 'unpaid'
        ORDER BY  start_time ASC
    `, [doctor_id, type]);
    return results;
};

export const getAppointmentsByClinicByclinicID = async (clinic_id) => {
    try {
        const results = await db.query(`
        SELECT 
        d.*,
    a.*,
    u.*,
    c.clinic_id AS clinic_id,
    c.clinic_name AS clinic_name
FROM tbl_appointments a 
INNER JOIN tbl_users u ON a.user_id = u.user_id  
INNER JOIN tbl_clinics c ON a.clinic_id = c.clinic_id 
INNER JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
WHERE a.clinic_id = ? 
  AND a.payment_status != 'unpaid'
ORDER BY a.start_time ASC
            `, [clinic_id])
        return results;
    }
    catch (error) {
        console.error("Error in getAppointmentsByClinicId:", error);
        throw error;
    }
}

export const getAppointmentByAppointmentId = async (clinicId, appointment_id) => {
    try {
        const results = await db.query(`
      SELECT 
      d.*,
          a.*,
          u.*,
          c.clinic_id AS clinic_id,
          c.clinic_name AS clinic_name
      FROM tbl_appointments a 
      INNER JOIN tbl_users u ON a.user_id = u.user_id  
      INNER JOIN tbl_clinics c ON a.clinic_id = ? 
      INNER JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
      WHERE a.appointment_id = ?
        AND a.payment_status != 'unpaid'
      LIMIT 1
    `, [clinicId, appointment_id]);
        return results;
    } catch (error) {
        console.error("Error in getAppointmentByAppointmentId:", error);
        throw error;
    }
};


export const getAppointmentsByClinicId = async (clinic_id) => {
    try {
        const results = await db.query(`
            SELECT 
                a.appointment_id AS appointment_id,
                a.doctor_id AS appointment_doctor_id,
                a.user_id AS appointment_user_id,
                a.clinic_id AS appointment_clinic_id,
                a.start_time AS appointment_start_time,
                a.end_time AS appointment_end_time,
                a.type AS appointment_type,
                a.status AS appointment_status,
                a.created_at AS appointment_created_at,
                a.updated_at AS appointment_updated_at,

                c.clinic_id AS clinic_id,
                c.zynq_user_id AS clinic_zynq_user_id,
                c.clinic_name AS clinic_name,
                c.org_number AS clinic_org_number,
                c.email AS clinic_email,
                c.mobile_number AS clinic_mobile_number,
                c.address AS clinic_address,
                c.is_invited AS clinic_is_invited,
                c.is_active AS clinic_is_active,
                c.is_deleted AS clinic_is_deleted,
                c.onboarding_token AS clinic_onboarding_token,
                c.profile_completion_percentage AS clinic_profile_completion_percentage,
                c.created_at AS clinic_created_at,
                c.updated_at AS clinic_updated_at,
                c.email_sent_at AS clinic_email_sent_at,
                c.email_sent_count AS clinic_email_sent_count,
                c.fee_range AS clinic_fee_range,
                c.website_url AS clinic_website_url,
                c.clinic_description AS clinic_description,
                c.clinic_logo AS clinic_logo,
                c.language AS clinic_language,
                c.form_stage AS clinic_form_stage,
                c.ivo_registration_number AS clinic_ivo_registration_number,
                c.hsa_id AS clinic_hsa_id,
                c.is_onboarded AS clinic_is_onboarded,
                c.is_unsubscribed AS clinic_is_unsubscribed,

                u.user_id AS user_id,
                u.email AS user_email,
                u.full_name AS user_full_name,
                u.age AS user_age,
                u.gender AS user_gender,
                u.mobile_number AS user_mobile_number,
                u.fcm_token AS user_fcm_token,
                u.profile_image AS user_profile_image,
                u.language AS user_language,
                u.is_verified AS user_is_verified,
                u.is_active AS user_is_active,
                u.is_push_notification_on AS user_push_notification_on,
                u.is_location_on AS user_is_location_on,
                u.created_at AS user_created_at,
                u.updated_at AS user_updated_at,
                u.latitude AS user_latitude,
                u.longitude AS user_longitude,
                u.udid AS user_udid,
                u.isOnline AS user_isOnline,

                d.doctor_id AS doctor_id,
                d.zynq_user_id AS doctor_zynq_user_id,
                d.name AS doctor_name,
                d.specialization AS doctor_specialization,
                d.employee_id AS doctor_employee_id,
                d.experience_years AS doctor_experience_years,
                d.rating AS doctor_rating,
                d.fee_per_session AS doctor_fee_per_session,
                d.session_duration AS doctor_session_duration,
                d.currency AS doctor_currency,
                d.phone AS doctor_phone,
                d.age AS doctor_age,
                d.address AS doctor_address,
                d.biography AS doctor_biography,
                d.gender AS doctor_gender,
                d.profile_image AS doctor_profile_image,
                d.created_at AS doctor_created_at,
                d.updated_at AS doctor_updated_at,
                d.profile_completion_percentage AS doctor_profile_completion_percentage,
                d.isOnline AS doctor_isOnline

            FROM tbl_appointments a 
            INNER JOIN tbl_users u ON a.user_id = u.user_id  
            INNER JOIN tbl_clinics c ON a.clinic_id = c.clinic_id 
            INNER JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
            WHERE a.clinic_id = ? And a.payment_status != 'unpaid'
            ORDER BY a.start_time ASC
        `, [clinic_id]);

        return results;
    } catch (error) {
        console.error("Error in getAppointmentsByClinicId:", error);
        throw error;
    }
};

export const updateAppointmentStatus = async (appointment_id, status) => {
    try {
        return await db.query(
            `UPDATE tbl_appointments SET status = ? WHERE appointment_id = ?`,
            [status, appointment_id]
        );
    } catch (error) {
        console.error("Database Error in updating appointment status:", error.message);
        throw error;
    }
};

export const getAppointmentsById = async (user_id, appointment_id, lang = "en") => {
    const nameColumn = lang === "sv" ? "cnc.swedish" : "cnc.name";
    console.log('user_id, appointment_id', user_id, appointment_id);

    const results = await db.query(`
        SELECT 
            a.*,
            d.*,
            zu.email,
            r.pdf,
            c.clinic_name,
            ANY_VALUE(cl.latitude) AS latitude,
            ANY_VALUE(cl.longitude) AS longitude,
            ANY_VALUE(a.created_at) AS created_at,
            ANY_VALUE(a.updated_at) AS updated_at,
            IFNULL(GROUP_CONCAT(DISTINCT ${nameColumn} SEPARATOR ', '), '') AS concerns
        FROM tbl_appointments a
        LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
        LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
        LEFT JOIN tbl_face_scan_results r ON r.face_scan_result_id = a.report_id
        LEFT JOIN tbl_clinic_locations cl ON cl.clinic_id = a.clinic_id
        LEFT JOIN tbl_appointment_concerns ac ON ac.appointment_id = a.appointment_id
        LEFT JOIN tbl_concerns cnc ON cnc.concern_id = ac.concern_id
        LEFT JOIN tbl_clinics c ON c.clinic_id = a.clinic_id
        WHERE a.user_id = ? AND a.appointment_id = ?
        GROUP BY a.appointment_id
    `, [user_id, appointment_id]);

    if (!results || results.length === 0) return [];

    return results.map(row => {
        if ('embeddings' in row) {
            delete row.embeddings;
        }

        const concernsArray = (row.concerns || '')
            .split(',')
            .map(name => name.trim())
            .filter(Boolean);

        return {
            ...row,
            concerns: concernsArray
        };
    });
};


export const getAppointmentDataByAppointmentID = async (appointment_id) => {
    try {
        const results = await db.query(` 
            SELECT doctor_id, clinic_id, user_id FROM tbl_appointments WHERE appointment_id  = ?
        `, [appointment_id]);
        console.log({ results });
        return results;
    } catch (error) {
        console.error("Database Error in getAppointmentDataByAppointmentID:", error.message);
        throw error;

    }
};

export const getAppointmentByIdForDoctor = async (doctor_id, appointment_id) => {
    try {
        const results = await db.query(`
         SELECT a.*, u.* , c.clinic_name , r.pdf FROM tbl_appointments a INNER JOIN tbl_users u ON a.user_id = u.user_id  INNER JOIN tbl_clinics c ON a.clinic_id = c.clinic_id LEFT JOIN tbl_face_scan_results r ON r.face_scan_result_id  = a.report_id
         WHERE a.doctor_id = ? AND a.appointment_id  = ? AND a.payment_status != 'unpaid'
         ORDER BY  start_time ASC
     `, [doctor_id, appointment_id]);
        return results;
    } catch (error) {
        console.error("Database Error in getAppointmentByIdForDoctor:", error.message);
        throw error;

    }
};

export const getAppointmentByIdForDoctorV2 = async (doctor_id, appointment_id) => {
    try {
        const results = await db.query(`
         SELECT 
         a.*, u.*, c.clinic_name, r.pdf 
         FROM tbl_appointments a 
         LEFT JOIN tbl_users u ON a.user_id = u.user_id  
         LEFT JOIN tbl_clinics c ON a.clinic_id = c.clinic_id 
         LEFT JOIN tbl_face_scan_results r ON r.face_scan_result_id  = a.report_id
         WHERE a.doctor_id = ? AND a.appointment_id  = ? AND a.payment_status != 'unpaid'
         ORDER BY  start_time ASC
     `, [doctor_id, appointment_id]);
        return results;
    } catch (error) {
        console.error("Database Error in getAppointmentByIdForDoctor:", error.message);
        throw error;

    }
};

export const rescheduleAppointment = async (appointment_id, start_time, end_time) => {
    try {
        return await db.query(`UPDATE tbl_appointments SET start_time = ?, end_time = ?, status = "Rescheduled" WHERE appointment_id = ?`, [start_time, end_time, appointment_id]);
    } catch (error) {
        console.error("Database Error in rescheduling appointment:", error.message);
        throw error;
    }
};

export const insertAppointmentRating = async ({ appointment_id, clinic_id, doctor_id, user_id, rating, review }) => {
    try {
        return await db.query(`INSERT INTO tbl_appointment_ratings (appointment_id, clinic_id, doctor_id, user_id, rating, review) VALUES (?, ?, ?, ?, ?, ?)`, [appointment_id, clinic_id, doctor_id, user_id, rating, review]);
    } catch (error) {
        console.error("Database Error in rating appointment:", error.message);
        throw error;
    }
};

export const getAppointmentsByRole = async (id, role) => {
    let whereClause = '';
    const values = [];

    if (role === 'DOCTOR' || role === 'SOLO_DOCTOR') {
        whereClause = "a.doctor_id = ?  AND a.payment_status != 'unpaid'";
        values.push(id);
    } else if (role === 'CLINIC') {
        whereClause = "a.clinic_id = ?  AND a.payment_status != 'unpaid'";
        values.push(id);
    } else {
        throw new Error('Invalid role provided');
    }

    const rows = await db.query(`
        SELECT 
            -- Appointment
            a.appointment_id,
            a.user_id,
            a.doctor_id,
            a.clinic_id,
            a.status AS appointment_status,
            a.start_time,
            a.end_time,
            a.report_id,
            a.type AS appointment_type,
            a.created_at AS appointment_created_at,
            a.updated_at AS appointment_updated_at,

            -- Doctor
            d.doctor_id AS doctor_doctor_id,
            d.zynq_user_id AS doctor_zynq_user_id,
            d.name AS doctor_name,
            d.specialization AS doctor_specialization,
            d.employee_id AS doctor_employee_id,
            d.experience_years AS doctor_experience_years,
            d.rating AS doctor_rating,
            d.fee_per_session AS doctor_fee_per_session,
            d.session_duration AS doctor_session_duration,
            d.currency AS doctor_currency,
            d.phone AS doctor_phone,
            d.age AS doctor_age,
            d.address AS doctor_address,
            d.biography AS doctor_biography,
            d.gender AS doctor_gender,
            d.profile_image AS doctor_profile_image,
            d.created_at AS doctor_created_at,
            d.updated_at AS doctor_updated_at,
            d.profile_completion_percentage AS doctor_profile_completion_percentage,
            d.isOnline AS doctor_isOnline,

            -- Clinic
            c.clinic_id AS clinic_clinic_id,
            c.zynq_user_id AS clinic_zynq_user_id,
            c.clinic_name AS clinic_name,
            c.org_number AS clinic_org_number,
            c.email AS clinic_email,
            c.mobile_number AS clinic_mobile_number,
            c.address AS clinic_address,
            c.is_invited AS clinic_is_invited,
            c.is_active AS clinic_is_active,
            c.is_deleted AS clinic_is_deleted,
            c.onboarding_token AS clinic_onboarding_token,
            c.profile_completion_percentage AS clinic_profile_completion_percentage,
            c.created_at AS clinic_created_at,
            c.updated_at AS clinic_updated_at,
            c.email_sent_at AS clinic_email_sent_at,
            c.email_sent_count AS clinic_email_sent_count,
            c.fee_range AS clinic_fee_range,
            c.website_url AS clinic_website_url,
            c.clinic_description AS clinic_description,
            c.clinic_logo AS clinic_logo,
            c.language AS clinic_language,
            c.form_stage AS clinic_form_stage,
            c.ivo_registration_number AS clinic_ivo_registration_number,
            c.hsa_id AS clinic_hsa_id,
            c.is_onboarded AS clinic_is_onboarded,
            c.is_unsubscribed AS clinic_is_unsubscribed,

            -- User
            u.user_id AS user_user_id,
            u.email AS user_email,
            u.full_name AS user_name,
            u.age AS user_age,
            u.gender AS user_gender,
            u.mobile_number AS user_mobile_number,
            u.language AS user_language,
            u.is_active AS user_is_active,
            u.created_at AS user_created_at,
            u.updated_at AS user_updated_at,
            u.latitude AS user_latitude,
            u.longitude AS user_longitude,
            u.isOnline AS user_isOnline,
            u.profile_image AS user_profile_image,

            -- Face Scan
            fs.face_scan_result_id AS face_scan_id,
            fs.skin_type AS face_scan_skin_type,
            fs.skin_concerns AS face_scan_skin_concerns,
            fs.face AS face_scan_face,
            fs.pdf AS face_scan_pdf,
            fs.details AS face_scan_details,
            fs.created_at AS face_scan_created_at,
            fs.updated_at AS face_scan_updated_at,
            fs.aiAnalysisResult AS face_scan_aiAnalysisResult,
            fs.scoreInfo AS face_scan_scoreInfo

        FROM tbl_appointments a
        INNER JOIN tbl_doctors d ON d.doctor_id = a.doctor_id
        INNER JOIN tbl_clinics c ON c.clinic_id = a.clinic_id
        INNER JOIN tbl_users u ON u.user_id = a.user_id
        LEFT JOIN tbl_face_scan_results fs ON fs.face_scan_result_id = a.report_id
        WHERE ${whereClause}
        ORDER BY a.start_time DESC
    `, values);

    const groupedByUser = {};

    for (const row of rows) {
        const userId = row.user_user_id;
        const faceScanId = row.face_scan_id;
        // const appointmentCreatedAt = dayjs.utc(row.appointment_created_at).toISOString();
        const appointmentCreatedAt = safeDate(row.appointment_created_at);

        if (!groupedByUser[userId]) {
            groupedByUser[userId] = {
                user_id: userId,
                email: row.user_email,
                name: row.user_name,
                age: row.user_age,
                gender: row.user_gender,
                mobile_number: row.user_mobile_number,
                language: row.user_language,
                is_active: row.user_is_active,
                created_at: row.user_created_at,
                updated_at: row.user_updated_at,
                latitude: row.user_latitude,
                longitude: row.user_longitude,
                isOnline: row.user_isOnline,
                profile_image: formatImagePath(row.user_profile_image, ''),
                appointments: [],
                face_scans: [],
                lastBooked: appointmentCreatedAt
            };
        } else {
            const existingLast = groupedByUser[userId].lastBooked;
            if (!existingLast || dayjs(appointmentCreatedAt).isAfter(existingLast)) {
                groupedByUser[userId].lastBooked = appointmentCreatedAt;
            }
        }

        if (
            faceScanId &&
            !groupedByUser[userId].face_scans.some(scan => scan.face_scan_id === faceScanId)
        ) {
            groupedByUser[userId].face_scans.push({
                face_scan_id: faceScanId,
                skin_type: row.face_scan_skin_type,
                skin_concerns: row.face_scan_skin_concerns,
                face: formatImagePath(row.face_scan_face, ''),
                pdf: formatImagePath(row.face_scan_pdf, ''),
                details: row.face_scan_details,
                aiAnalysisResult: row.face_scan_aiAnalysisResult,
                scoreInfo: row.face_scan_scoreInfo,
                created_at: row.face_scan_created_at ? dayjs.utc(row.face_scan_created_at).toISOString() : null,
                updated_at: row.face_scan_updated_at ? dayjs.utc(row.face_scan_updated_at).toISOString() : null
            });
        }

        groupedByUser[userId].appointments.push({
            appointment_id: row.appointment_id,
            doctor_id: row.doctor_id,
            clinic_id: row.clinic_id,
            status: row.appointment_status,
            start_time: row.start_time,
            end_time: row.end_time,
            type: row.appointment_type,
            report_id: row.report_id,
            created_at: appointmentCreatedAt,
            // updated_at: dayjs.utc(row.appointment_updated_at).toISOString(),
            updated_at: safeDate(row.appointment_updated_at),

            doctor: {
                doctor_id: row.doctor_doctor_id,
                zynq_user_id: row.doctor_zynq_user_id,
                name: row.doctor_name,
                specialization: row.doctor_specialization,
                employee_id: row.doctor_employee_id,
                experience_years: row.doctor_experience_years,
                rating: row.doctor_rating,
                fee_per_session: row.doctor_fee_per_session,
                session_duration: row.doctor_session_duration,
                currency: row.doctor_currency,
                phone: row.doctor_phone,
                age: row.doctor_age,
                address: row.doctor_address,
                biography: row.doctor_biography,
                gender: row.doctor_gender,
                profile_image: formatImagePath(row.doctor_profile_image, 'doctor/profile_images'),
                created_at: row.doctor_created_at,
                updated_at: row.doctor_updated_at,
                profile_completion_percentage: row.doctor_profile_completion_percentage,
                isOnline: row.doctor_isOnline
            },

            clinic: {
                clinic_id: row.clinic_clinic_id,
                zynq_user_id: row.clinic_zynq_user_id,
                clinic_name: row.clinic_name,
                org_number: row.clinic_org_number,
                email: row.clinic_email,
                mobile_number: row.clinic_mobile_number,
                address: row.clinic_address,
                is_invited: row.clinic_is_invited,
                is_active: row.clinic_is_active,
                is_deleted: row.clinic_is_deleted,
                onboarding_token: row.clinic_onboarding_token,
                profile_completion_percentage: row.clinic_profile_completion_percentage,
                created_at: row.clinic_created_at,
                updated_at: row.clinic_updated_at,
                email_sent_at: row.clinic_email_sent_at,
                email_sent_count: row.clinic_email_sent_count,
                fee_range: row.clinic_fee_range,
                website_url: row.clinic_website_url,
                clinic_description: row.clinic_description,
                clinic_logo: formatImagePath(row.clinic_logo, 'clinic/logos'),
                language: row.clinic_language,
                form_stage: row.clinic_form_stage,
                ivo_registration_number: row.clinic_ivo_registration_number,
                hsa_id: row.clinic_hsa_id,
                is_onboarded: row.clinic_is_onboarded,
                is_unsubscribed: row.clinic_is_unsubscribed
            },

            face_scan: faceScanId ? faceScanId : null
        });
    }

    return Object.values(groupedByUser);
};

export const getAppointmentsByRoleAndSinglePatient = async (id, role, patient_id) => {
    let whereClause = '';
    const values = [];

    if (role === 'DOCTOR' || role === 'SOLO_DOCTOR') {
        whereClause = "a.doctor_id = ? AND a.user_id = ? AND a.payment_status != 'unpaid'";
        values.push(id, patient_id);
    } else if (role === 'CLINIC') {
        whereClause = "a.clinic_id = ? AND a.user_id = ? AND a.payment_status != 'unpaid'";
        values.push(id, patient_id);
    } else {
        throw new Error('Invalid role provided');
    }

    const rows = await db.query(`
        SELECT 
            -- Appointment
            a.appointment_id,
            a.user_id,
            a.doctor_id,
            a.clinic_id,
            a.status AS appointment_status,
            a.start_time,
            a.end_time,
            a.report_id,
            a.type AS appointment_type,
            a.created_at AS appointment_created_at,
            a.updated_at AS appointment_updated_at,

            -- Doctor
            d.doctor_id AS doctor_doctor_id,
            d.zynq_user_id AS doctor_zynq_user_id,
            d.name AS doctor_name,
            d.specialization AS doctor_specialization,
            d.employee_id AS doctor_employee_id,
            d.experience_years AS doctor_experience_years,
            d.rating AS doctor_rating,
            d.fee_per_session AS doctor_fee_per_session,
            d.session_duration AS doctor_session_duration,
            d.currency AS doctor_currency,
            d.phone AS doctor_phone,
            d.age AS doctor_age,
            d.address AS doctor_address,
            d.biography AS doctor_biography,
            d.gender AS doctor_gender,
            d.profile_image AS doctor_profile_image,
            d.created_at AS doctor_created_at,
            d.updated_at AS doctor_updated_at,
            d.profile_completion_percentage AS doctor_profile_completion_percentage,
            d.isOnline AS doctor_isOnline,

            -- Clinic
            c.clinic_id AS clinic_clinic_id,
            c.zynq_user_id AS clinic_zynq_user_id,
            c.clinic_name AS clinic_name,
            c.org_number AS clinic_org_number,
            c.email AS clinic_email,
            c.mobile_number AS clinic_mobile_number,
            c.address AS clinic_address,
            c.is_invited AS clinic_is_invited,
            c.is_active AS clinic_is_active,
            c.is_deleted AS clinic_is_deleted,
            c.onboarding_token AS clinic_onboarding_token,
            c.profile_completion_percentage AS clinic_profile_completion_percentage,
            c.created_at AS clinic_created_at,
            c.updated_at AS clinic_updated_at,
            c.email_sent_at AS clinic_email_sent_at,
            c.email_sent_count AS clinic_email_sent_count,
            c.fee_range AS clinic_fee_range,
            c.website_url AS clinic_website_url,
            c.clinic_description AS clinic_description,
            c.clinic_logo AS clinic_logo,
            c.language AS clinic_language,
            c.form_stage AS clinic_form_stage,
            c.ivo_registration_number AS clinic_ivo_registration_number,
            c.hsa_id AS clinic_hsa_id,
            c.is_onboarded AS clinic_is_onboarded,
            c.is_unsubscribed AS clinic_is_unsubscribed,

            -- User
            u.user_id AS user_user_id,
            u.email AS user_email,
            u.full_name AS user_name,
            u.age AS user_age,
            u.gender AS user_gender,
            u.mobile_number AS user_mobile_number,
            u.language AS user_language,
            u.is_active AS user_is_active,
            u.created_at AS user_created_at,
            u.updated_at AS user_updated_at,
            u.latitude AS user_latitude,
            u.longitude AS user_longitude,
            u.isOnline AS user_isOnline,
            u.profile_image AS user_profile_image,

            -- Face Scan
            fs.face_scan_result_id AS face_scan_id,
            fs.skin_type AS face_scan_skin_type,
            fs.skin_concerns AS face_scan_skin_concerns,
            fs.face AS face_scan_face,
            fs.pdf AS face_scan_pdf,
            fs.details AS face_scan_details,
            fs.created_at AS face_scan_created_at,
            fs.updated_at AS face_scan_updated_at,
            fs.aiAnalysisResult AS face_scan_aiAnalysisResult,
            fs.scoreInfo AS face_scan_scoreInfo

        FROM tbl_appointments a
        INNER JOIN tbl_doctors d ON d.doctor_id = a.doctor_id
        INNER JOIN tbl_clinics c ON c.clinic_id = a.clinic_id
        INNER JOIN tbl_users u ON u.user_id = a.user_id
        LEFT JOIN tbl_face_scan_results fs ON fs.face_scan_result_id = a.report_id
        WHERE ${whereClause}
        ORDER BY a.start_time DESC
    `, values);

    // Since it's a single patient, groupedByUser will have only one key
    const groupedByUser = {};

    for (const row of rows) {
        const userId = row.user_user_id;
        const faceScanId = row.face_scan_id;
        // const appointmentCreatedAt = dayjs.utc(row.appointment_created_at).toISOString();
        const appointmentCreatedAt = safeDate(row.appointment_created_at);

        if (!groupedByUser[userId]) {
            groupedByUser[userId] = {
                user_id: userId,
                email: row.user_email,
                name: row.user_name,
                age: row.user_age,
                gender: row.user_gender,
                mobile_number: row.user_mobile_number,
                language: row.user_language,
                is_active: row.user_is_active,
                created_at: row.user_created_at,
                updated_at: row.user_updated_at,
                latitude: row.user_latitude,
                longitude: row.user_longitude,
                isOnline: row.user_isOnline,
                profile_image: formatImagePath(row.user_profile_image, ''),
                appointments: [],
                face_scans: [],
                lastBooked: appointmentCreatedAt
            };
        } else {
            const existingLast = groupedByUser[userId].lastBooked;
            if (!existingLast || dayjs(appointmentCreatedAt).isAfter(existingLast)) {
                groupedByUser[userId].lastBooked = appointmentCreatedAt;
            }
        }

        if (
            faceScanId &&
            !groupedByUser[userId].face_scans.some(scan => scan.face_scan_id === faceScanId)
        ) {
            groupedByUser[userId].face_scans.push({
                face_scan_id: faceScanId,
                skin_type: row.face_scan_skin_type,
                skin_concerns: row.face_scan_skin_concerns,
                face: formatImagePath(row.face_scan_face, ''),
                pdf: formatImagePath(row.face_scan_pdf, ''),
                details: row.face_scan_details,
                aiAnalysisResult: row.face_scan_aiAnalysisResult,
                scoreInfo: row.face_scan_scoreInfo,
                created_at: row.face_scan_created_at ? dayjs.utc(row.face_scan_created_at).toISOString() : null,
                updated_at: row.face_scan_updated_at ? dayjs.utc(row.face_scan_updated_at).toISOString() : null
            });
        }

        groupedByUser[userId].appointments.push({
            appointment_id: row.appointment_id,
            doctor_id: row.doctor_id,
            clinic_id: row.clinic_id,
            status: row.appointment_status,
            start_time: row.start_time,
            end_time: row.end_time,
            type: row.appointment_type,
            report_id: row.report_id,
            created_at: appointmentCreatedAt,
            // updated_at: dayjs.utc(row.appointment_updated_at).toISOString(),
            updated_at: safeDate(row.appointment_updated_at),

            doctor: {
                doctor_id: row.doctor_doctor_id,
                zynq_user_id: row.doctor_zynq_user_id,
                name: row.doctor_name,
                specialization: row.doctor_specialization,
                employee_id: row.doctor_employee_id,
                experience_years: row.doctor_experience_years,
                rating: row.doctor_rating,
                fee_per_session: row.doctor_fee_per_session,
                session_duration: row.doctor_session_duration,
                currency: row.doctor_currency,
                phone: row.doctor_phone,
                age: row.doctor_age,
                address: row.doctor_address,
                biography: row.doctor_biography,
                gender: row.doctor_gender,
                profile_image: formatImagePath(row.doctor_profile_image, 'doctor/profile_images'),
                created_at: row.doctor_created_at,
                updated_at: row.doctor_updated_at,
                profile_completion_percentage: row.doctor_profile_completion_percentage,
                isOnline: row.doctor_isOnline
            },

            clinic: {
                clinic_id: row.clinic_clinic_id,
                zynq_user_id: row.clinic_zynq_user_id,
                clinic_name: row.clinic_name,
                org_number: row.clinic_org_number,
                email: row.clinic_email,
                mobile_number: row.clinic_mobile_number,
                address: row.clinic_address,
                is_invited: row.clinic_is_invited,
                is_active: row.clinic_is_active,
                is_deleted: row.clinic_is_deleted,
                onboarding_token: row.clinic_onboarding_token,
                profile_completion_percentage: row.clinic_profile_completion_percentage,
                created_at: row.clinic_created_at,
                updated_at: row.clinic_updated_at,
                email_sent_at: row.clinic_email_sent_at,
                email_sent_count: row.clinic_email_sent_count,
                fee_range: row.clinic_fee_range,
                website_url: row.clinic_website_url,
                clinic_description: row.clinic_description,
                clinic_logo: formatImagePath(row.clinic_logo, 'clinic/logos'),
                language: row.clinic_language,
                form_stage: row.clinic_form_stage,
                ivo_registration_number: row.clinic_ivo_registration_number,
                hsa_id: row.clinic_hsa_id,
                is_onboarded: row.clinic_is_onboarded,
                is_unsubscribed: row.clinic_is_unsubscribed
            },

            face_scan: faceScanId ? faceScanId : null
        });
    }

    return Object.values(groupedByUser);
};


export const getPatientRecords = async (userData) => {
    try {
        const { user_id, role } = extractUserData(userData);
        const results = await getAppointmentsByRole(user_id, role);
        return results;
    } catch (error) {
        console.error("Database Error in getPatientRecords:", error.message);
        throw error;
    }
};

export const getSinglePatientRecord = async (userData, patient_id) => {
    try {
        const { user_id, role } = extractUserData(userData);
        const results = await getAppointmentsByRoleAndSinglePatient(user_id, role, patient_id);
        return results;
    } catch (error) {
        console.error("Database Error in getPatientRecords:", error.message);
        throw error;
    }
};

export const getRatingsByRole = async (id, role) => {
    try {
        let whereClause = ' ar.approval_status = `APPROVED` AND ';
        const values = [id];
        switch (role) {
            case 'DOCTOR':
            case 'SOLO_DOCTOR':
                whereClause = 'ar.doctor_id = ?';
                break;
            case 'CLINIC':
                whereClause = 'ar.clinic_id = ?';
                break;
            default:
                throw new Error('Invalid role for fetching ratings');
        }


        const query = `
    SELECT 
        ar.appointment_rating_id,
        ar.appointment_id,
        ar.doctor_id,
        d.name,
        ar.rating,
        ar.review,
        ar.created_at,
        u.user_id,
        u.full_name,
        u.profile_image,
        u.age,
        u.gender
    FROM tbl_appointment_ratings AS ar
    INNER JOIN tbl_users AS u 
        ON ar.user_id = u.user_id
    INNER JOIN tbl_doctors AS d 
        ON ar.doctor_id = d.doctor_id 
    WHERE ${whereClause}
    ORDER BY ar.created_at DESC
`;


        const rows = await db.query(query, values);

        return rows.map((row) => ({
            ...row,
            profile_image: formatImagePath(row.profile_image, '')
        }));

    } catch (error) {
        console.error("Database Error in getRatingsByRole:", error.message);
        throw error;
    }
};



export const getRatings = async (userData) => {
    try {
        const { user_id, role } = extractUserData(userData);
        const results = await getRatingsByRole(user_id, role);
        return results;
    } catch (error) {
        console.error("Database Error in getRatings:", error.message);
        throw error;
    }
};

export const getAppointmentsForNotification = async (windowStart, windowEnd) => {
    return await db.query(`
        SELECT
            a.appointment_id,
            a.user_id,
            a.doctor_id,
            a.start_time,
            u.full_name AS user_name,
            u.fcm_token AS user_fcm_token,
            u.is_push_notification_on AS user_push_notification,
            d.name AS doctor_name,
            zu.fcm_token AS doctor_fcm_token,
            a.reminder_24h_sent,
            a.reminder_1h_sent
        FROM tbl_appointments a
        LEFT JOIN tbl_users u ON a.user_id = u.user_id
        LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
        LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
        WHERE 
        a.status IN ('Scheduled', 'Rescheduled')
        AND a.save_type = 'booked'
        AND a.start_time BETWEEN ? AND ?
        AND (a.reminder_24h_sent = 0 OR a.reminder_1h_sent = 0)
    `, [windowStart, windowEnd]);
};

export const updateAppointment = async (data) => {
    const {
        appointment_id, doctor_id, clinic_id, total_price, admin_earnings, clinic_earnings,
        type, start_time, end_time, save_type, status, payment_timing
    } = data;

    const query = `
    UPDATE tbl_appointments
    SET doctor_id = ?, clinic_id = ?, total_price = ?, admin_earnings = ?, clinic_earnings = ?, type = ?,
        start_time = ?, end_time = ?, save_type = ?, status = ?, updated_at = CURRENT_TIMESTAM , payment_timing = ?
    WHERE appointment_id = ?
  `;
    return await db.query(query, [doctor_id, clinic_id, total_price, admin_earnings, clinic_earnings, type, start_time, end_time, save_type, status, payment_timing, appointment_id]);
};

export const updateAppointmentV3 = async (data) => {
    const {
        appointment_id, doctor_id, clinic_id, total_price, admin_earnings, clinic_earnings,
        type, start_time, end_time, save_type, status, total_price_with_discount, discounted_amount, payment_timing
    } = data;

    const query = `
    UPDATE tbl_appointments
    SET doctor_id = ?, clinic_id = ?, total_price = ?, admin_earnings = ?, clinic_earnings = ?, 
    type = ?, start_time = ?, end_time = ?, save_type = ?, status = ?, 
    updated_at = CURRENT_TIMESTAMP, total_price_with_discount = ?, discounted_amount = ? , payment_timing = ?
    WHERE appointment_id = ?
  `;
    return await db.query(query, [doctor_id, clinic_id, total_price, admin_earnings,
        clinic_earnings, type, start_time, end_time, save_type, status,
        total_price_with_discount, discounted_amount, payment_timing, appointment_id]);
};

export const updateAppointmentV2 = async (data) => {
    const {
        appointment_id, doctor_id, clinic_id, total_price, admin_earnings, clinic_earnings,
        type, start_time, end_time, save_type, status, is_paid, payment_status
    } = data;

    const query = `
    UPDATE tbl_appointments
    SET 
    doctor_id = ?, clinic_id = ?, total_price = ?, admin_earnings = ?, clinic_earnings = ?, 
    type = ?, start_time = ?, end_time = ?, save_type = ?, status = ?, updated_at = CURRENT_TIMESTAMP, 
    payment_status = ?, is_paid = ?
    WHERE appointment_id = ?
  `;
    return await db.query(query, [doctor_id, clinic_id, total_price, admin_earnings, clinic_earnings, type, start_time, end_time, save_type, status, payment_status, is_paid, appointment_id]);
};

export const deleteAppointmentTreatments = async (appointment_id) => {
    return await db.query(`DELETE FROM tbl_appointment_treatments WHERE appointment_id = ?`, [appointment_id]);
};


export const insertAppointmentTreatments = async (appointment_id, treatments) => {
    try {
        if (!Array.isArray(treatments) || treatments.length === 0) return;

        let values = [];

        for (const t of treatments) {
            const subs = Array.isArray(t.sub_treatments) ? t.sub_treatments : [];

            if (subs.length > 0) {

                const totalPrice = subs.reduce(
                    (sum, item) => sum + Number(item.sub_treatment_price || 0),
                    0
                );

                for (const sub of subs) {
                    values.push([
                        appointment_id,
                        t.treatment_id,
                        totalPrice,
                        sub.sub_treatment_id,
                        Number(sub.sub_treatment_price || 0) // never null
                    ]);
                }

            } else {

                values.push([
                    appointment_id,
                    t.treatment_id,
                    Number(t.price || 0),
                    null,               // allowed
                    0                   // MUST be 0 (NOT NULL)
                ]);
            }
        }

        if (values.length > 0) {
            const query = `
                INSERT INTO tbl_appointment_treatments (
                    appointment_id,
                    treatment_id,
                    price,
                    sub_treatment_id,
                    sub_treatment_price
                ) VALUES ?
            `;
            await db.query(query, [values]);
        }

        return true;

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert appointment treatments.");
    }
};

export const getAppointmentTreatments = async (appointment_id, language) => {
    const query = `
        SELECT 
            ap.*,

            t.name AS treatment_name,
            t.swedish AS treatment_swedish,

            st.sub_treatment_id,
            st.name AS sub_treatment_name,
            st.swedish AS sub_treatment_swedish

        FROM tbl_appointment_treatments ap
        INNER JOIN tbl_treatments t 
            ON ap.treatment_id = t.treatment_id
        LEFT JOIN tbl_sub_treatment_master st 
            ON ap.sub_treatment_id = st.sub_treatment_id
        WHERE ap.appointment_id = ?
        ORDER BY t.name, st.name
    `;

    const rows = await db.query(query, [appointment_id]);

    const grouped = {};

    for (const row of rows) {

        if (!grouped[row.treatment_id]) {
            grouped[row.treatment_id] = {
                treatment_id: row.treatment_id,
                name: language === 'sv' ? row.treatment_swedish : row.treatment_name,
                swedish: row.treatment_swedish,
                price: row.price,
                sub_treatments: []
            };
        }

        if (row.sub_treatment_id) {
            grouped[row.treatment_id].sub_treatments.push({
                sub_treatment_id: row.sub_treatment_id,
                name: language === 'sv' ? row.sub_treatment_swedish : row.sub_treatment_name,
                swedish: row.sub_treatment_swedish,
                price: row.sub_treatment_price
            });
        }
    }

    // Remove embeddings safely
    const result = Object.values(grouped).map(item => {
        delete item.embeddings;
        delete item.name_embeddings;
        return item;
    });
    return result;
};

export const getDoctorBookedAppointmentsModel = async (role, user_id) => {
    let whereClause = '';
    let values = [user_id];

    switch (role) {
        case 'DOCTOR':
        case 'SOLO_DOCTOR':
            whereClause = 'a.doctor_id = ?';
            break;
        case 'CLINIC':
            whereClause = 'a.clinic_id = ?';
            break;
        default:
            throw new Error('Invalid role');
    }

    let query = `
    SELECT 
      a.*,
      d.*,
      zu.email,
      r.pdf,
      c.clinic_name
    FROM tbl_appointments a
    LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
    LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
    LEFT JOIN tbl_face_scan_results r ON r.face_scan_result_id = a.report_id
    LEFT JOIN tbl_clinics c ON c.clinic_id = a.clinic_id
    WHERE ${whereClause} AND a.save_type = 'booked' AND a.total_price > 0 AND a.payment_status != 'unpaid'
    ORDER BY a.created_at DESC
    `

    return await db.query(query, values);
};
export const updateMissedAppointmentStatusModel = async () => {
    let query = `
    UPDATE tbl_appointments SET
    status = "Missed"
    WHERE status = "Scheduled" AND end_time < UTC_TIMESTAMP()`

    return await db.query(query);
}


export const cancelAppointment = async (appointment_id, data) => {

    const result = await db.query(
        `UPDATE tbl_appointments SET status = ? , cancelled_by = ? , cancelled_by_id = ?, cancel_reason = ? , payment_status = ? WHERE appointment_id = ?`,
        [data.status, data.cancelled_by, data.cancelled_by_id, data.cancel_reason, data.payment_status, appointment_id]
    );
    return result.affectedRows;
};


export const updateAppointmentAsPaid = async (appointment_id, status) => {
    const is_paid = status === 'paid' ? 1 : 0;
    const query = `
    UPDATE tbl_appointments
    SET payment_status = ?, is_paid = ?
    WHERE appointment_id = ?
  `;
    return await db.query(query, [status, is_paid, appointment_id]);
};


export const insertContactUs = async (contactData) => {
    try {
        const { email, first_name, last_name, phone_number, message } = contactData;

        return await db.query(`
            INSERT INTO tbl_contact_us 
            (email, first_name, last_name, phone_number, message) 
            VALUES (?, ?, ?, ?, ?)`, [email, first_name, last_name, phone_number, message]);
    } catch (error) {
        console.error("Database Error in inserting contact us data:", error.message);
        throw error;
    }
};

export const getContactUsData = async () => {
    try {
        return await db.query(`SELECT * FROM tbl_contact_us ORDER BY created_at DESC`);
    } catch (error) {
        console.error("Database Error in getting contact us data:", error.message);
        throw error;
    }
};

export const getAppointmentsByUserIdAndDoctorId = async (user_id, doctor_id, status) => {
    const results = await db.query(` 
        SELECT * FROM tbl_appointments WHERE user_id = ? AND  doctor_id = ?  AND save_type = ? 
    `, [user_id, doctor_id, status]);
    return results;
};


export const getDraftAppointmentsModel = async (user_id, doctor_id) => {
    const rows = await db.query(`
        SELECT 
            at.appointment_id,
            at.treatment_id,
            at.sub_treatment_id

        FROM tbl_appointments a
        INNER JOIN tbl_appointment_treatments at 
            ON a.appointment_id = at.appointment_id
        INNER JOIN tbl_treatments t
            ON at.treatment_id = t.treatment_id
        LEFT JOIN tbl_sub_treatment_master st
            ON at.sub_treatment_id = st.sub_treatment_id

        WHERE 
            a.user_id = ?
            AND a.doctor_id = ?
            AND a.save_type = 'draft'
        ORDER BY t.name, st.name
    `, [user_id, doctor_id]);

    // ---- Group by treatment ----
    const grouped = {};

    for (const row of rows) {
        if (!grouped[row.treatment_id]) {
            grouped[row.treatment_id] = {
                treatment_id: row.treatment_id,
                sub_treatments: []
            };
        }

        if (row.sub_treatment_id) {
            grouped[row.treatment_id].sub_treatments.push({
                sub_treatment_id: row.sub_treatment_id,
            });
        }
    }

    return Object.values(grouped);
};

export const insertDraftTreatmentsModel = async (appointment_id, treatments) => {
    if (!treatments || !treatments.length) return;

    try {
        const params = [];

        for (const treatment of treatments) {
            const mainPrice = treatment.price ? treatment.price : 0;

            // If sub-treatments exist → create row for each sub
            if (treatment.sub_treatments?.length) {
                treatment.sub_treatments.forEach(sub => {
                    params.push([
                        appointment_id,
                        treatment.treatment_id,
                        mainPrice,                // always main treatment price
                        sub.sub_treatment_id,
                        sub.price                 // sub treatment price
                    ]);
                });
            } else {
                // If NO sub-treatments → insert single row
                params.push([
                    appointment_id,
                    treatment.treatment_id,
                    mainPrice,
                    null,                       // no sub
                    0
                ]);
            }
        }

        const query = `
      INSERT INTO tbl_appointment_treatments
      (appointment_id, treatment_id, price, sub_treatment_id, sub_treatment_price)
      VALUES ?
    `;

        console.log("query", query);
        console.log("params", params);

        return await db.query(query, [params]);

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert draft treatments.");
    }
};

export const insertDraftAppointmentModel = async (appointment_id, doctor_id, clinic_id, user_id, report_id, discount_type, discount_value) => {
    try {
        const query = `
            INSERT INTO tbl_appointments
        (appointment_id, user_id, doctor_id, clinic_id, status, save_type, is_paid, payment_status, report_id, discount_type, discount_value, type)
        VALUES (?, ?, ?, ?, 'Scheduled', 'draft', 0, 'unpaid', ?, ?, ?, 'Video Call')`

        return await db.query(query, [appointment_id, user_id, doctor_id, clinic_id, report_id, discount_type, discount_value]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert draft appointment.");
    }
}

export const getDraftAppointmentData = async (user_id, doctor_id, clinic_id) => {
    return await db.query(`
        SELECT a.* FROM tbl_appointments a
        WHERE a.user_id = ? AND a.doctor_id = ? AND a.clinic_id = ? AND a.save_type = 'draft' AND a.status = 'Scheduled' AND a.is_paid = 0 AND a.payment_status = 'unpaid'
    `, [user_id, doctor_id, clinic_id]);
}

export const deleteDraftTreatmentsModel = async (appointment_id) => {
    return await db.query(`
        DELETE FROM tbl_appointment_treatments WHERE appointment_id = ?
    `, [appointment_id]);
}

export const deleteDraftAppointmentModel = async (appointment_id) => {
    return await db.query(`
        DELETE FROM tbl_appointments WHERE appointment_id = ?
    `, [appointment_id]);
}

export const getAppointmentDetailsByAppointmentID = async (appointment_id) => {
    try {
        return await db.query(`
            SELECT a.*, d.zynq_user_id as doctor_zynq_user_id 
            FROM tbl_appointments a
            LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
            WHERE appointment_id = ?
        `, [appointment_id]);
    } catch (error) {
        console.error("Database Error in getAppointmentDetailsByAppointmentID:", error.message);
        throw new Error("Failed to get appointment details.");
    }
}

export const insertSuggestedAppointmentModel = async (origin_appointment_id, appointment_id) => {
    try {
        return await db.query(`
            UPDATE tbl_appointments SET
            suggested_appointment_id = ?
            WHERE appointment_id = ?
        `, [appointment_id, origin_appointment_id]);
    } catch (error) {
        console.error("Database Error in insertSuggestedAppointmentModel:", error.message);
        throw new Error("Failed to insert suggested appointment.");
    }
}

export const deleteDraftAppointmentsModel = async (user_id, appointment_id) => {
    try {
        return await db.query(`
            DELETE FROM tbl_appointments WHERE user_id = ? AND appointment_id = ?
        `, [user_id, appointment_id]);
    } catch (error) {
        console.error("Database Error in deleteDraftAppointmentsModel:", error.message);
        throw new Error("Failed to delete draft appointments.");
    }
}

export const updateAppointmentConcerns = async (appointment_id, concerns) => {
    try {
        if (concerns.length > 0) {
            const values = concerns.map(concern_id => [appointment_id, concern_id]);
            await db.query(
                `INSERT INTO tbl_appointment_concerns (appointment_id, concern_id) VALUES ?`,
                [values]
            );
        }
    } catch (error) {
        console.error("Database Error in updateAppointmentConcerns:", error.message);
        throw new Error("Failed to update appointment indications.");
    }
}

export const getNumberOfAppointments = async (user_id) => {
    try {
        return await db.query(`
            SELECT COUNT(*) as count FROM tbl_appointments WHERE user_id = ?
        `, [user_id]);
    } catch (error) {
        console.error("Database Error in getNumberOfAppointments:", error.message);
        throw new Error("Failed to get number of appointments.");
    }
}