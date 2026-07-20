import db from "../config/db.js";
import { applyLanguageOverwrite } from "../utils/misc.util.js";
import { isEmpty } from "../utils/user_helper.js";
import { get_product_images_by_product_ids } from "./api.js";

//======================================= Admin =========================================

export const findEmail = async (email) => {
    // try {
    return await db.query('SELECT * FROM `tbl_admin` WHERE email = ?', [email]);
    // } catch (error) {
    //     console.error("Database Error:", error.message);
    //     throw new Error("Failed to get admin data.");
    // }
};

export const updateData = async (admin_id, token, fcm_token) => {
    try {
        return await db.query('UPDATE `tbl_admin` SET jwt_token = ?, fcm_token = ? WHERE admin_id = ?', [token, fcm_token, admin_id]);
    } catch (error) {
        console.error("Update Error:", error.message);
        throw new Error("Failed to update admin token.");
    }
};

export const findById = async (admin_id) => {
    try {
        return await db.query('SELECT * FROM `tbl_admin` WHERE admin_id = ?', [admin_id])
    } catch (error) {
        console.error("Update Error:", error.message);
        throw new Error("Failed to update admin token.");
    }
};

export const updatePassword = async (admin_id, password) => {
    try {
        return await db.query('UPDATE `tbl_admin` SET password = ? WHERE admin_id = ?', [password, admin_id]);
    } catch (error) {
        console.error("Update Error:", error.message);
        throw new Error("Failed to update password.");
    }
};

export const updateProfile = async (admin_id, updateData) => {
    try {
        return await db.query('UPDATE `tbl_admin` SET `full_name` = ?,`email` = ?,`mobile_number` = ?,`profile_image`= ? WHERE admin_id = ?', [updateData.full_name, updateData.email, updateData.mobile_number, updateData.profile_image, admin_id])
    } catch (error) {
        console.error("Update Error:", error.message);
        throw new Error("Failed to update profile.");
    }
};

//======================================= Dashboard =========================================

export const get_clinics = async () => {
    try {
        return await db.query('SELECT * FROM `tbl_clinics` WHERE is_deleted = 0;');
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get dashboard clinic data.");
    }
};

export const get_doctors = async () => {
    try {
        return await db.query('SELECT * FROM `tbl_doctors`');
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get dashboard doctor data.");
    }
};

export const get_users = async () => {
    try {
        return await db.query('SELECT * FROM `tbl_users` WHERE is_verified = 1 AND is_deleted = 0');
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get dashboard users data.");
    }
};

export const get_latest_clinic = async () => {
    try {
        return await db.query('SELECT clinic_id, clinic_name, address, DATE_FORMAT(created_at, "%M %d, %Y") AS date_joined, profile_completion_percentage AS onboarding_progress FROM `tbl_clinics` WHERE is_deleted = 0 ORDER BY created_at DESC;')
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get dashboard latest data.");
    }
};


export const get_admin_earning = async () => {
    try {
        const result = await db.query(
            `
            SELECT
                ROUND(
                    ( (SELECT COALESCE(SUM(admin_earnings), 0) FROM tbl_product_purchase)
                      +
                      (SELECT COALESCE(SUM(admin_earnings), 0) FROM tbl_appointments WHERE save_type = 'booked' AND status != 'Cancelled' AND payment_status NOT IN ('unpaid', 'failed', 'refund_completed', 'refund_initiated'))
                    ), 2
                ) AS total_admin_earnings,

                ROUND(
                    (SELECT COALESCE(SUM(balance), 0) FROM tbl_wallet),
                2) AS total_refunds,

                ROUND(
                    ( (SELECT COALESCE(SUM(total_price), 0) FROM tbl_product_purchase)
                      +
                      (SELECT COALESCE(SUM(total_price), 0) FROM tbl_appointments WHERE save_type = 'booked' AND status != 'Cancelled' AND payment_status NOT IN ('unpaid', 'failed', 'refund_completed', 'refund_initiated'))
                    ), 2
                ) AS total_platform_earnings,

                (
                    SELECT COUNT(DISTINCT purchase_id) 
                    FROM tbl_product_purchase
                ) AS total_purchases
            ;
            `
        );

        return result[0]; // return first row with all fields
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get admin earning data.");
    }
};

//======================================= User Managment =========================================
export const get_users_count = async (search, status, startDate, endDate) => {
    try {
        let whereClause = "WHERE tbl_users.is_verified = 1 AND tbl_users.is_deleted = 0";
        const params = [];

        if (search) {
            whereClause += " AND (tbl_users.full_name LIKE ? OR tbl_users.email LIKE ? OR tbl_users.mobile_number LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        if (status) {
            whereClause += " AND tbl_users.approval_status = ?";
            params.push(status);
        }

        if (startDate) {
            whereClause += " AND tbl_users.created_at >= ?";
            params.push(`${startDate} 00:00:00`);
        }

        if (endDate) {
            whereClause += " AND tbl_users.created_at <= ?";
            params.push(`${endDate} 23:59:59`);
        }

        const sql = `SELECT COUNT(tbl_users.user_id) AS count FROM tbl_users ${whereClause};`;
        const result = await db.query(sql, params);
        return result[0]?.count || 0;
    } catch (error) {
        console.error("Database Error in get_users_count:", error.message);
        throw new Error("Failed to count users.");
    }
};

export const get_users_managment = async (limit, offset, search, sortBy, sortOrder, status, startDate, endDate) => {
    try {
        const allowedSortColumns = {
            full_name: 'tbl_users.full_name',
            email: 'tbl_users.email',
            mobile_number: 'tbl_users.mobile_number',
            created_at: 'tbl_users.created_at',
            total_ai_scan_done: 'total_ai_scan_done',
            total_appointment: 'total_appointment'
        };
        const orderByCol = allowedSortColumns[sortBy] || 'tbl_users.created_at';
        const orderDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        let whereClause = "WHERE tbl_users.is_verified = 1 AND tbl_users.is_deleted = 0";
        const params = [];

        if (search) {
            whereClause += " AND (tbl_users.full_name LIKE ? OR tbl_users.email LIKE ? OR tbl_users.mobile_number LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        if (status) {
            whereClause += " AND tbl_users.approval_status = ?";
            params.push(status);
        }

        if (startDate) {
            whereClause += " AND tbl_users.created_at >= ?";
            params.push(`${startDate} 00:00:00`);
        }

        if (endDate) {
            whereClause += " AND tbl_users.created_at <= ?";
            params.push(`${endDate} 23:59:59`);
        }

        const sql = `SELECT
            tbl_users.user_id,
            tbl_users.email,
            tbl_users.full_name,
            tbl_users.approval_status,
            tbl_users.age,
            tbl_users.gender,
            tbl_users.mobile_number,
            tbl_users.profile_image,
            tbl_users.language,
            tbl_users.is_verified,
            tbl_users.is_active,
            tbl_users.is_deleted,
            tbl_users.is_push_notification_on,
            tbl_users.is_location_on,
            tbl_users.created_at,
            tbl_users.updated_at,
            tbl_users.latitude,
            tbl_users.longitude,
            tbl_users.udid,
            tbl_users.isOnline,
            tbl_users.stripe_customer_id,
            COUNT(DISTINCT tbl_face_scan_results.face_scan_result_id) AS total_ai_scan_done,
            COUNT(DISTINCT tbl_appointments.appointment_id) AS total_appointment
        FROM tbl_users
        LEFT JOIN tbl_face_scan_results
            ON tbl_face_scan_results.user_id = tbl_users.user_id
        LEFT JOIN tbl_appointments
            ON tbl_appointments.user_id = tbl_users.user_id
           AND tbl_appointments.payment_status != 'unpaid'
        ${whereClause}
        GROUP BY tbl_users.user_id
        ORDER BY ${orderByCol} ${orderDir}
        LIMIT ? OFFSET ?;`;

        params.push(limit, offset);

        return await db.query(sql, params);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get user latest data.");
    }
};

export const get_all_face_scan_results = async () => {
    try {
        const rows = await db.query(`SELECT * FROM tbl_face_scan_results ORDER BY created_at DESC`);
        return rows;
    } catch (error) {
        console.error("Error fetching face scan results:", error);
        throw error;
    }
};




export const update_user_status = async (user_id, is_active) => {
    try {
        return await db.query('UPDATE `tbl_users` SET `is_active`= "' + is_active + '" WHERE user_id = "' + user_id + '"')
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update user status.");
    }
};

//======================================= Clinic Managment =========================================

export const findRole = async (role) => {
    try {
        const [rows] = await db.query('SELECT * FROM `tbl_roles` WHERE role = ?', [role]);
        return rows;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to find role.");
    }
};

export const findClinicEmail = async (email) => {
    try {
        return await db.query('SELECT * FROM `tbl_zqnq_users` WHERE email = ?', [email]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to find zynq users email.");
    }
};

export const addClinic = async (data) => {
    try {
        return await db.query(
            'INSERT INTO `tbl_clinics`(`zynq_user_id`, `clinic_name`, `org_number`, `email`, `mobile_number`, `address`) VALUES (?, ?, ?, ?, ?, ?)',
            [data.zynq_user_id, data.clinic_name, data.org_number, data.email, data.mobile_number, data.address]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to add clinic.");
    }
};

export const findClinicByClinicUserId = async (id) => {
    try {
        return await db.query('SELECT * FROM `tbl_clinics` WHERE zynq_user_id = ?', [id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to find clinic by zynq user id.");
    }
};

export const addClinicLocationAddress = async (data) => {
    try {
        return await db.query(
            'INSERT INTO `tbl_clinic_locations`(`clinic_id`, `city`, `zip_code`, `latitude`, `longitude`) VALUES (?, ?, ?, ?, ?)',
            [data.clinic_id, data.city, data.zip_code, data.latitude, data.longitude]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to add zynq user.");
    }
}

export const addZynqUsers = async (data) => {
    try {
        const result = await db.query(
            'INSERT INTO `tbl_zqnq_users`(`email`, `role_id`,`password`,`show_password`) VALUES (?, ?,?,?)',
            [data.email, data.role_id, data.password, data.show_password]
        );

        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to add zynq user.");
    }
};

export const insert_clinic = async (clinic) => {
    try {
        return await db.query(
            `INSERT INTO tbl_clinics 
            (clinic_name, org_number, email, mobile_number, address, onboarding_token, is_invited) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                clinic.clinic_name,
                clinic.org_number,
                clinic.email,
                clinic.mobile_number,
                clinic.address,
                clinic.token,
                false
            ]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic data.");
    }
};

export const get_clinic_managment = async (limit, offset, search = "", status = "", type = "", sortBy = "created_at", sortOrder = "DESC") => {
    try {
        const searchQuery = `%${search}%`;

        let conditions = `
            c.is_deleted = 0
            AND zu.role_id IN (
                '2fc0b43c-3196-11f0-9e07-0e8e5d906eef',
                '407595e3-3196-11f0-9e07-0e8e5d906eef'
            )
            AND (
                c.clinic_name LIKE ?
                OR c.email LIKE ?
                OR c.mobile_number LIKE ?
            )
        `;

        // ⭐ Add Status Filter
        const params = [searchQuery, searchQuery, searchQuery];

        if (status) {
            conditions += ` AND c.profile_status = ?`;
            params.push(status);
        }

        // ⭐ Add Type Filter (mapping Clinic / Solo Doctor)
        if (type) {
            if (type === "Clinic") {
                conditions += ` AND zu.role_id = '2fc0b43c-3196-11f0-9e07-0e8e5d906eef'`;
            } else if (type === "Solo Doctor") {
                conditions += ` AND zu.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef'`;
            }
        }

        const allowedSortColumns = {
            clinic_name: 'c.clinic_name',
            email: 'c.email',
            mobile_number: 'c.mobile_number',
            created_at: 'c.created_at',
            onboarding_progress: 'c.profile_completion_percentage',
            profile_status: 'c.profile_status'
        };
        const orderByCol = allowedSortColumns[sortBy] || 'c.created_at';
        const orderDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        params.push(limit, offset);

        const query = `
            SELECT 
                c.zynq_user_id,
                c.clinic_id, 
                c.clinic_name, 
                c.org_number, 
                c.email, 
                c.mobile_number, 
                c.address, 
                c.email_sent_count, 
                c.clinic_logo, 
                c.clinic_description, 
                c.website_url, 
                c.profile_status,
                c.profile_completion_percentage AS onboarding_progress, 
                cl.city, 
                cl.zip_code AS postal_code,
                cl.latitude,
                cl.longitude,
                c.ivo_registration_number, 
                c.hsa_id,
                c.slot_time,
                c.same_for_all,

                CASE 
                    WHEN zu.role_id = '2fc0b43c-3196-11f0-9e07-0e8e5d906eef' THEN 'Clinic'
                    WHEN zu.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef' THEN 'Solo Doctor'
                END AS user_type

            FROM tbl_clinics c
            LEFT JOIN tbl_clinic_locations cl 
                ON cl.clinic_id = c.clinic_id
            LEFT JOIN tbl_zqnq_users zu 
                ON zu.id = c.zynq_user_id

            WHERE ${conditions}

            ORDER BY ${orderByCol} ${orderDir}
            LIMIT ? OFFSET ?
        `;

        return await db.query(query, params);

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get clinic management data.");
    }
};


export const getClinicListForDoctorOnboardingModel = async (status = "") => {
    try {
        let conditions = `
      c.is_deleted = 0 AND c.profile_status IN ('CLAIMED','ONBOARDING','VERIFIED')
      AND zu.role_id = '2fc0b43c-3196-11f0-9e07-0e8e5d906eef'
    `;

        const params = [];

        if (status) {
            conditions += ` AND c.profile_status = ?`;
            params.push(status);
        }

        const query = `
      SELECT 
        c.zynq_user_id,
        c.clinic_id,
        c.clinic_name,
        c.email,
        c.mobile_number,
        'Clinic' AS user_type,
        COALESCE(
          JSON_ARRAYAGG(
            CASE 
              WHEN coh.clinic_id IS NOT NULL THEN JSON_OBJECT(
                'day_of_week', coh.day_of_week,
                'open_time', coh.open_time,
                'close_time', coh.close_time,
                'is_closed', coh.is_closed
              )
            END
          ),
          JSON_ARRAY()
        ) AS clinic_timing
      FROM tbl_clinics c
      LEFT JOIN tbl_zqnq_users zu 
        ON zu.id = c.zynq_user_id
      LEFT JOIN tbl_clinic_operation_hours coh 
        ON coh.clinic_id = c.clinic_id
      WHERE ${conditions}
      GROUP BY 
        c.clinic_id,
        c.zynq_user_id,
        c.clinic_name,
        c.email,
        c.mobile_number
      ORDER BY c.created_at DESC
    `;

        const clinics = await db.query(query, params);

        // 🔒 Ensure clinic_timing is parsed JSON
        return clinics.map(item => {
            let clinicTiming = [];

            if (item.clinic_timing) {
                const parsed =
                    Array.isArray(item.clinic_timing)
                        ? item.clinic_timing
                        : JSON.parse(item.clinic_timing);

                // ✅ Remove null entries
                clinicTiming = parsed.filter(t => t !== null);
            }

            return {
                ...item,
                clinic_timing: clinicTiming
            };
        });


    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get clinic management data.");
    }
};




export const get_clinics_count = async (search = "") => {
    try {
        const searchQuery = `%${search}%`;

        const result = await db.query(`
            SELECT COUNT(*) AS total
            FROM tbl_clinics c
            LEFT JOIN tbl_zqnq_users zu 
                ON zu.id = c.zynq_user_id
            WHERE c.is_deleted = 0
              AND zu.role_id IN (
                    '2fc0b43c-3196-11f0-9e07-0e8e5d906eef',
                    '407595e3-3196-11f0-9e07-0e8e5d906eef'
              )
              AND (
                    c.clinic_name LIKE ?
                    OR c.email LIKE ?
                    OR c.mobile_number LIKE ?
                )
        `, [searchQuery, searchQuery, searchQuery]);

        return result[0]?.total || 0;

    } catch (error) {
        console.error("Count Error:", error.message);
        throw new Error("Failed to count clinics.");
    }
};


export const get_clinic_treatments = async (clinic_id) => {
    return await db.query('SELECT tbl_clinic_treatments.clinic_treatment_id, tbl_clinic_treatments.clinic_id, tbl_treatments.name FROM tbl_clinic_treatments LEFT JOIN tbl_treatments ON tbl_treatments.treatment_id = tbl_clinic_treatments.treatment_id WHERE tbl_clinic_treatments.clinic_id = ? ORDER BY tbl_clinic_treatments.created_at DESC;', [clinic_id])
};

export const get_clinic_equipments = async (clinic_id) => {
    return await db.query('SELECT tbl_clinic_equipments.clinic_equipment_id, tbl_clinic_equipments.clinic_id, tbl_equipments.name FROM tbl_clinic_equipments LEFT JOIN tbl_equipments ON tbl_equipments.equipment_id = tbl_clinic_equipments.equipment_id WHERE tbl_clinic_equipments.clinic_id = ? ORDER BY tbl_clinic_equipments.created_at DESC;', [clinic_id])
};

export const get_clinic_skintype = async (clinic_id) => {
    return await db.query('SELECT tst.* FROM tbl_clinic_skin_types tcst LEFT JOIN tbl_skin_types tst ON tst.skin_type_id = tcst.skin_type_id WHERE tcst.clinic_id = ? ORDER BY tcst.created_at DESC;', [clinic_id])
};

export const get_clinic_serveritylevel = async (clinic_id) => {
    return await db.query('SELECT tbl_severity_levels.* FROM tbl_clinic_severity_levels LEFT JOIN tbl_severity_levels ON tbl_severity_levels.severity_level_id = tbl_clinic_severity_levels.severity_id WHERE tbl_clinic_severity_levels.clinic_id = ? ORDER BY tbl_clinic_severity_levels.created_at DESC', [clinic_id])
}

export const get_clinic_skin_conditions = async (clinic_id) => {
    return await db.query(`
        SELECT 
            tbl_clinic_skin_condition.clinic_skin_condition_id, 
            tbl_clinic_skin_condition.clinic_id, 
            tbl_skin_conditions.name 
        FROM tbl_clinic_skin_condition 
        LEFT JOIN tbl_skin_conditions 
            ON tbl_skin_conditions.skin_condition_id = tbl_clinic_skin_condition.skin_condition_id 
        WHERE tbl_clinic_skin_condition.clinic_id = ? 
        ORDER BY tbl_clinic_skin_condition.created_at DESC
    `, [clinic_id]);
};

export const get_clinic_surgeries = async (clinic_id) => {
    return await db.query(`
        SELECT 
            tbl_clinic_surgery.clinic_surgery_id, 
            tbl_clinic_surgery.clinic_id, 
            tbl_surgery.type,
            tbl_surgery.swedish AS name,
            tbl_surgery.surgery_id 
        FROM tbl_clinic_surgery 
        LEFT JOIN tbl_surgery 
            ON tbl_surgery.surgery_id = tbl_clinic_surgery.surgery_id 
        WHERE tbl_clinic_surgery.clinic_id = ? 
        ORDER BY tbl_clinic_surgery.created_at DESC
    `, [clinic_id]);
};

export const get_clinic_aesthetic_devices = async (clinic_id) => {
    return await db.query(`
        SELECT 
            tbl_clinic_aesthetic_devices.clinic_aesthetic_devices_id, 
            tbl_clinic_aesthetic_devices.clinic_id, 
            tbl_aesthetic_devices.device 
        FROM tbl_clinic_aesthetic_devices 
        LEFT JOIN tbl_aesthetic_devices 
            ON tbl_aesthetic_devices.aesthetic_device_id  = tbl_clinic_aesthetic_devices.aesthetic_devices_id 
        WHERE tbl_clinic_aesthetic_devices.clinic_id = ? 
        ORDER BY tbl_clinic_aesthetic_devices.created_at DESC
    `, [clinic_id]);
};



export const delete_clinic_by_id = async (clinic_id) => {
    try {
        return await db.query('UPDATE `tbl_clinics` SET `is_deleted`= 1 WHERE clinic_id = ?', [clinic_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to delete clinic data.");
    }
};

export const findClinicById = async (clinic_id) => {
    try {
        return await db.query('SELECT tbl_clinics.*, tbl_clinic_locations.city, tbl_clinic_locations.zip_code FROM `tbl_clinics` LEFT JOIN tbl_clinic_locations ON tbl_clinic_locations.clinic_id = tbl_clinics.clinic_id WHERE tbl_clinics.clinic_id IN(?) AND tbl_clinics.is_unsubscribed = 0;', [clinic_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to find clinic data.");
    }
};

export const updatePasseordByClinicId = async (hashedPassword, password, zynq_user_id) => {
    try {
        return await db.query('UPDATE `tbl_zqnq_users` SET `password`= ?,`show_password`= ? WHERE id = ?', [hashedPassword, password, zynq_user_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update password clinic data.");
    }
};

export const updateClinicCountAndEmailSent = async (clinic_id, email_sent_count, date) => {
    try {
        const query = `
            UPDATE tbl_clinics
            SET 
                email_sent_at = ?,
                email_sent_count = ?,
                profile_status = 'INVITED',
                invited_date = CURRENT_TIMESTAMP()
            WHERE clinic_id = ?
        `;

        return await db.query(query, [date, email_sent_count, clinic_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic count and email sent data.");
    }
};

export const clinicSubscribed = async (clinic_id) => {
    try {
        await db.query('UPDATE `tbl_clinics` SET `is_invited`= 1 WHERE clinic_id = ?', [clinic_id]);
        return await db.query('SELECT * FROM `tbl_clinics` WHERE clinic_id = ?', [clinic_id])
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic invited status.");
    }
};

export const clinicUnsubscribed = async (clinic_id) => {
    try {
        return await db.query('UPDATE `tbl_clinics` SET `is_unsubscribed`= 1 WHERE clinic_id = ?', [clinic_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic unscubscribed status.");
    }
};

export const get_doctors_management = async (limit, offset, search = "", type = "", zync_user_id, sortBy = "created_at", sortOrder = "DESC") => {
    try {
        const searchQuery = `%${search}%`;

        let conditions = `
            u.role_id IN (
                '407595e3-3196-11f0-9e07-0e8e5d906eef',  -- Solo Doctor
                '3677a3e6-3196-11f0-9e07-0e8e5d906eef'   -- Doctor
            )
            AND (
                d.name LIKE ?
                OR u.email LIKE ?
                OR d.phone LIKE ?
            )
        `;

        const params = [searchQuery, searchQuery, searchQuery];

        // TYPE FILTER
        if (type) {
            if (type === "Solo Doctor") {
                conditions += ` AND u.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef'`;
            } else if (type === "Doctor") {
                conditions += ` AND u.role_id = '3677a3e6-3196-11f0-9e07-0e8e5d906eef'`;
            }
        }

        if (zync_user_id) {
            conditions += ` AND u.id = ?`;
            params.push(zync_user_id);
        }

        const allowedSortColumns = {
            name: 'd.name',
            email: 'u.email',
            phone: 'd.phone',
            created_at: 'd.created_at',
            onboarding_progress: 'd.profile_completion_percentage',
            profile_status: 'd.profile_status',
            rating: 'rating'
        };
        const orderByCol = allowedSortColumns[sortBy] || 'd.created_at';
        const orderDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        params.push(limit, offset);

        const sql = `
            SELECT 
                d.zynq_user_id,
                d.doctor_id, 
                d.name,
                d.last_name,
                d.specialization, 
                d.fee_per_session, 
                d.phone, 
                d.profile_status,
                d.profile_image, 
                IFNULL(ROUND(AVG(ar.rating), 2), 0) AS rating, 
                d.age, 
                d.address, 
                d.gender, 
                d.experience_years, 
                d.biography, 
                d.profile_completion_percentage AS onboarding_progress, 
                u.email,
                d.city,
                d.zip_code,
                d.latitude,
                d.longitude,
                CASE 
                    WHEN u.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef' THEN 'Solo Doctor'
                    WHEN u.role_id = '3677a3e6-3196-11f0-9e07-0e8e5d906eef' THEN 'Doctor'
                END AS user_type
            FROM tbl_doctors d
            LEFT JOIN tbl_zqnq_users u 
                ON u.id = d.zynq_user_id
            LEFT JOIN tbl_appointment_ratings ar
                ON ar.doctor_id = d.doctor_id

            WHERE ${conditions}

            GROUP BY d.doctor_id
            ORDER BY ${orderByCol} ${orderDir}
            LIMIT ? OFFSET ?;
        `;

        return await db.query(sql, params);

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor management data.");
    }
};

export const get_doctors_count = async (search = "", type = "") => {
    try {
        const searchQuery = `%${search}%`;

        let conditions = `
            u.role_id IN (
                '407595e3-3196-11f0-9e07-0e8e5d906eef',  -- Solo Doctor
                '3677a3e6-3196-11f0-9e07-0e8e5d906eef'   -- Doctor
            )
            AND (
                d.name LIKE ?
                OR u.email LIKE ?
                OR d.phone LIKE ?
            )
        `;

        const params = [searchQuery, searchQuery, searchQuery];

        // TYPE FILTER
        if (type) {
            if (type === "Solo Doctor") {
                conditions += ` AND u.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef'`;
            } else if (type === "Doctor") {
                conditions += ` AND u.role_id = '3677a3e6-3196-11f0-9e07-0e8e5d906eef'`;
            }
        }

        const sql = `
            SELECT COUNT(*) AS total
            FROM tbl_doctors d
            LEFT JOIN tbl_zqnq_users u 
                ON u.id = d.zynq_user_id
            WHERE ${conditions};
        `;

        const result = await db.query(sql, params);
        return result[0].total;

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to count doctors.");
    }
};



export const get_doctor_experience = async (doctor_id) => {
    try {
        return await db.query('SELECT experience_id, organization, designation, start_date, end_date FROM `tbl_doctor_experiences` WHERE doctor_id = ?', [doctor_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor latest data.");
    }
};

export const get_doctor_education = async (doctor_id) => {
    try {
        return await db.query('SELECT education_id, degree, institution, start_year, end_year FROM `tbl_doctor_educations` WHERE doctor_id = ?', [doctor_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor latest data.");
    }
};

//======================================= Product Managment =========================================

export const get_products_management = async () => {
    try {
        return await db.query('SELECT tbl_products.approval_status, tbl_products.cover_image, tbl_products.product_id, tbl_products.name AS product_name, tbl_clinics.clinic_name, tbl_products.price, tbl_products.stock, tbl_products.rating, tbl_products.short_description, tbl_products.full_description FROM `tbl_products` LEFT JOIN tbl_clinics ON tbl_clinics.clinic_id = tbl_products.clinic_id WHERE tbl_products.is_deleted = 0 ORDER BY tbl_products.created_at DESC;')
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get product latest data.");
    }
};

export const get_single_product_management = async (product_id) => {
    try {
        return await db.query('SELECT tbl_products.approval_status,  tbl_products.cover_image, tbl_products.product_id, tbl_products.name AS product_name, tbl_clinics.clinic_name, tbl_products.price, tbl_products.stock, tbl_products.rating, tbl_products.short_description, tbl_products.full_description FROM `tbl_products` LEFT JOIN tbl_clinics ON tbl_clinics.clinic_id = tbl_products.clinic_id WHERE tbl_products.is_deleted = 0 AND tbl_products.product_id = ? ORDER BY tbl_products.created_at DESC;', [product_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get product latest data.");
    }
};

export const get_product_images_by_product_id = async (product_id, image_url) => {
    try {
        return await db.query(`SELECT tbl_product_images.*, CONCAT(?, image) AS image_url FROM tbl_product_images  WHERE product_id = ?`, [image_url, product_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get product image latest data.");
    }
};

export const delete_product_by_id = async (product_id) => {
    try {
        return await db.query('UPDATE `tbl_products` SET `is_deleted`= 1 WHERE product_id = ?', [product_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to delete product data.");
    }
}

//yashraj 
export const get_doctor_treatments = async (doctorId) => {
    try {
        const rows = await db.query(`
            SELECT 
                dt.doctor_id,
                dt.treatment_id,
                dt.price,
                dt.sub_treatment_id,
                dt.sub_treatment_price,
                
                tt.name AS treatment_name_en,
                tt.swedish AS treatment_name_sv,

                st.name AS sub_treatment_name_en,
                st.swedish AS sub_treatment_name_sv

            FROM 
                tbl_doctor_treatments dt
            INNER JOIN
                tbl_treatments tt 
                ON dt.treatment_id = tt.treatment_id
            LEFT JOIN 
                tbl_sub_treatment_master st
                ON dt.sub_treatment_id = st.sub_treatment_id

            WHERE 
                dt.doctor_id = ?
            ORDER BY tt.name, st.name
        `, [doctorId]);

        // ---- GROUPING LOGIC ----
        const grouped = {};

        rows.forEach(row => {
            if (!grouped[row.treatment_id]) {
                grouped[row.treatment_id] = {
                    doctor_id: row.doctor_id,
                    treatment_id: row.treatment_id,
                    name: row.treatment_name_en,
                    swedish: row.treatment_name_sv,
                    price: row.price,
                    sub_treatments: []
                };
            }

            // Add sub-treatment only if exists
            if (row.sub_treatment_id) {
                grouped[row.treatment_id].sub_treatments.push({
                    sub_treatment_id: row.sub_treatment_id,
                    sub_treatment_price: row.sub_treatment_price,
                    sub_treatment_name_en: row.sub_treatment_name_en,
                    sub_treatment_name_sv: row.sub_treatment_name_sv
                });
            }
        });

        return Object.values(grouped);

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor's treatments.");
    }
};

export const getDoctorClinicTreatments = async (doctorId, clinicId) => {
    try {
        const rows = await db.query(`
            SELECT 
                dt.doctor_id,
                dt.treatment_id,
                dt.price,
                dt.sub_treatment_id,
                dt.sub_treatment_price,
                
                tt.name AS treatment_name_en,
                tt.swedish AS treatment_name_sv,

                st.name AS sub_treatment_name_en,
                st.swedish AS sub_treatment_name_sv

            FROM 
                tbl_doctor_treatments dt
            INNER JOIN
                tbl_treatments tt 
                ON dt.treatment_id = tt.treatment_id
            LEFT JOIN 
                tbl_sub_treatment_master st
                ON dt.sub_treatment_id = st.sub_treatment_id

            WHERE 
                dt.doctor_id = ?
                AND dt.clinic_id = ?
            ORDER BY tt.name, st.name
        `, [doctorId, clinicId]);

        // ---- GROUPING LOGIC ----
        const grouped = {};

        rows.forEach(row => {
            if (!grouped[row.treatment_id]) {
                grouped[row.treatment_id] = {
                    doctor_id: row.doctor_id,
                    treatment_id: row.treatment_id,
                    name: row.treatment_name_en,
                    swedish: row.treatment_name_sv,
                    price: row.price,
                    sub_treatments: []
                };
            }

            // Add sub-treatment only if exists
            if (row.sub_treatment_id) {
                grouped[row.treatment_id].sub_treatments.push({
                    sub_treatment_id: row.sub_treatment_id,
                    sub_treatment_price: row.sub_treatment_price,
                    sub_treatment_name_en: row.sub_treatment_name_en,
                    sub_treatment_name_sv: row.sub_treatment_name_sv
                });
            }
        });

        return Object.values(grouped);

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor's treatments.");
    }
};

export const get_doctor_skin_types = async (doctorId) => {
    try {
        return await db.query(`
            SELECT 
                dst.*,
                tst.*
            FROM 
                tbl_doctor_skin_types dst
            INNER JOIN 
                tbl_skin_types tst
            ON 
                dst.skin_type_id = tst.skin_type_id  
            WHERE 
                dst.doctor_id = ?`, [doctorId]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor's skin types.");
    }
};

export const getDoctorClinicSkinTypes = async (doctorId, clinicId) => {
    try {
        return await db.query(`
            SELECT 
                dst.*,
                tst.*
            FROM 
                tbl_doctor_skin_types dst
            INNER JOIN 
                tbl_skin_types tst
            ON 
                dst.skin_type_id = tst.skin_type_id  
            WHERE 
                dst.doctor_id = ? AND dst.clinic_id = ?`, [doctorId, clinicId]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor's skin types.");
    }
};

export const get_doctor_severity_levels = async (doctorId) => {
    try {
        return await db.query(`
            SELECT 
                dsl.*,
                tsl.*
            FROM 
                tbl_doctor_severity_levels dsl
            INNER JOIN 
                tbl_severity_levels tsl
            ON 
                dsl.severity_id = tsl.severity_level_id   
            WHERE 
                dsl.doctor_id = ?`, [doctorId]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor's severity_levels");
    }
};

export const get_doctor_skin_conditions = async (doctorId) => {
    try {
        return await db.query(`
            SELECT 
                dsc.*,
                sc.name 
            FROM 
                tbl_doctor_skin_condition dsc
            INNER JOIN 
                tbl_skin_conditions sc 
            ON 
                dsc.skin_condition_id = sc.skin_condition_id
            WHERE 
                dsc.doctor_id = ?`, [doctorId]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor's skin conditions.");
    }
};

export const get_doctor_surgeries = async (doctorId, language = "en") => {
    try {
        const data = await db.query(`
            SELECT DISTINCT
                ds.doctor_surgery_id,
                ds.doctor_id,
                ds.clinic_id,
                ds.surgery_id,
                ds.updated_at,
                ds.created_at,
                s.type,
                s.swedish,
                s.english
            FROM  
                tbl_doctor_surgery ds
            INNER JOIN 
                tbl_surgery s 
            ON 
                ds.surgery_id = s.surgery_id
            WHERE 
                ds.doctor_id = ?`, [doctorId]);

        if (!data) {
            return [];
        }

        const sergeries = applyLanguageOverwrite(data, language);

        return sergeries;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor's surgeries.");
    }
};

export const getDoctorClinicSurgeries = async (doctorId, clinicId, language = "en") => {
    try {
        const data = await db.query(`
            SELECT DISTINCT
                ds.doctor_surgery_id,
                ds.doctor_id,
                ds.clinic_id,
                ds.surgery_id,
                ds.updated_at,
                ds.created_at,
                s.type,
                s.swedish,
                s.english
            FROM 
                tbl_doctor_surgery ds
            INNER JOIN 
                tbl_surgery s 
            ON 
                ds.surgery_id = s.surgery_id
            WHERE 
                ds.doctor_id = ? AND ds.clinic_id = ?`, [doctorId, clinicId]);

        if (!data) {
            return [];
        }

        const sergeries = applyLanguageOverwrite(data, language);

        return sergeries;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor's surgeries.");
    }
};

export const get_doctor_aesthetic_devices = async (doctorId) => {
    try {
        return await db.query(`
            SELECT 
                dad.*,
                ad.device 
            FROM 
                tbl_doctor_aesthetic_devices dad
            INNER JOIN 
                tbl_aesthetic_devices ad 
            ON 
                dad.doctor_aesthetic_devices_id = ad.aesthetic_device_id 
            WHERE 
                dad.doctor_id = ?`, [doctorId]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor's aesthetic devices.");
    }
};

export const getDoctorClinicDevices = async (zynqUserId, clinicId) => {
    try {
        return await db.query(`
            SELECT 
                tdum.*, td.device_name
            FROM 
                tbl_treatment_device_user_maps tdum
            JOIN 
                tbl_treatment_devices td 
            ON 
                tdum.device_id = td.id
            WHERE 
                tdum.zynq_user_id = ? AND tdum.clinic_id = ?`, [zynqUserId, clinicId]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor's aesthetic devices.");
    }
};

export const get_all_support_tickets = async () => {
    try {
        return await db.query('SELECT * FROM `tbl_support_tickets` ORDER BY `created_at` DESC;');
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get all support tickets.");
    }
}

export const get_clinic_by_id = async (clinic_id) => {
    try {
        return await db.query('SELECT * FROM `tbl_clinics` WHERE clinic_id = ?', [clinic_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get clinic by id.");
    }
}

export const get_doctor_by_id = async (doctor_id) => {
    try {
        const query = `
            SELECT 
                td.*, 
                tu.email, 
                tu.password
            FROM 
                tbl_doctors AS td
            JOIN 
                tbl_zqnq_users AS tu 
            ON 
                td.zynq_user_id = tu.id
            WHERE 
                td.doctor_id = ?;
        `;
        return await db.query(query, [doctor_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor and user data by doctor id.");
    }
}

export const get_user_by_id = async (user_id) => {
    try {
        return await db.query('SELECT * FROM `tbl_users` WHERE user_id = ?', [user_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get user by id.");
    }
}

export const get_support_ticket_by_id = async (support_ticket_id) => {
    try {
        return await db.query('SELECT * FROM `tbl_support_tickets` WHERE support_ticket_id = ?', [support_ticket_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get support ticket by id.");
    }
}

export const get_support_ticket_by_id_v2 = async (support_ticket_id) => {
    try {
        return await db.query(`
            SELECT
                st.*,
                r.role,
                COALESCE(st.doctor_id, d_from_clinic.doctor_id) AS doctor_id,
                c.clinic_id
            FROM tbl_support_tickets st

            LEFT JOIN tbl_clinics c 
                ON st.clinic_id = c.clinic_id
            LEFT JOIN tbl_zqnq_users zu_clinic 
                ON c.zynq_user_id = zu_clinic.id
            LEFT JOIN tbl_doctors d_from_clinic 
                ON zu_clinic.id = d_from_clinic.zynq_user_id

            LEFT JOIN tbl_roles r 
                ON r.id = COALESCE(zu_clinic.role_id, (
                    SELECT zu2.role_id
                    FROM tbl_doctors d2
                    JOIN tbl_zqnq_users zu2 ON d2.zynq_user_id = zu2.id
                    WHERE d2.doctor_id = st.doctor_id
                ))
            WHERE st.support_ticket_id = ?`, [support_ticket_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get support ticket by id.");
    }
};


export const update_support_ticket = async (support_ticket_id, updateData) => {
    try {
        return await db.query('UPDATE `tbl_support_tickets` SET `admin_response`= ?, `responded_at`= ? WHERE support_ticket_id = ?', [updateData.response, new Date(), support_ticket_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update support ticket.");
    }
}

export const getAdminBookedAppointmentsModel = async ({ page, limit } = {}) => {
    try {
        let query = `
            SELECT
                a.*,
                d.name AS doctor_name,
                zu.email AS doctor_email,
                c.clinic_name,
                r.role,
                u.full_name AS user_name,
                u.mobile_number AS user_mobile,

                -- ✅ Commission percentage (Admin share from total)
                CASE 
                    WHEN a.total_price > 0 
                        THEN ROUND((a.admin_earnings / a.total_price) * 100, 2) 
                    ELSE 0 
                END AS commission_percentage,

                COALESCE(
                    (
                        SELECT JSON_ARRAYAGG(
                            JSON_OBJECT(
                                'treatment_id', at.treatment_id,
                                'treatment_name', t.name,
                                'treatment_price', at.price
                            )
                        )
                        FROM tbl_appointment_treatments at
                        LEFT JOIN tbl_treatments t ON t.treatment_id = at.treatment_id
                        WHERE at.appointment_id = a.appointment_id
                          AND at.treatment_id IS NOT NULL
                    ),
                    JSON_ARRAY()
                ) AS treatments,

                COUNT(*) OVER() AS total_count
            FROM tbl_appointments a
            LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
            LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
            LEFT JOIN tbl_clinics c ON c.clinic_id = a.clinic_id
            LEFT JOIN tbl_users u ON u.user_id = a.user_id
            LEFT JOIN tbl_zqnq_users zu2 ON zu2.id = d.zynq_user_id
            LEFT JOIN tbl_roles r ON zu2.role_id = r.id
            WHERE a.save_type = 'booked' 
              AND a.total_price > 0 
              AND a.payment_status != 'unpaid'
            ORDER BY a.created_at DESC
        `;

        // 2️⃣ Apply pagination if page & limit are provided
        if (page && limit) {
            const offset = (page - 1) * limit;
            query += ` LIMIT ${limit} OFFSET ${offset}`;
        }

        // 3️⃣ Fetch appointments
        const appointmentRows = await db.query(query);
        if (!appointmentRows.length) return [];

        // 4️⃣ Build enriched appointments
        const appointments = appointmentRows.map(row => ({
            ...row,
            total_count: row.total_count // already from SQL
        }));

        return appointments;
    } catch (error) {
        console.error("Failed to fetch admin booked appointments:", error);
        throw error;
    }
};


export const getAdminReviewsModel = async () => {
    let query = `
        SELECT 
            ar.appointment_rating_id,
            ar.appointment_id,
            c.clinic_name,
            d.name as doctor_name,
            c.clinic_id,
            d.doctor_id,
            ar.rating,
            ar.review,
            ar.created_at,
            ar.approval_status,
            u.user_id,
            u.full_name,
            u.profile_image,
            u.age,
            u.gender
        FROM tbl_appointment_ratings AS ar
        LEFT JOIN tbl_appointments AS a ON ar.appointment_id = a.appointment_id
        LEFT JOIN tbl_doctors AS d ON a.doctor_id = d.doctor_id
        LEFT JOIN tbl_clinics AS c ON a.clinic_id = c.clinic_id
        LEFT JOIN tbl_users AS u ON ar.user_id = u.user_id
        ORDER BY ar.created_at DESC
    `;

    return await db.query(query);
}

const APP_URL = process.env.APP_URL;

export const getAdminPurchasedProductModel = async ({ page, limit } = {}) => {
    try {
        let purchaseQuery = `
            SELECT 
                pp.purchase_id,
                pp.cart_id,
                pp.product_details, 
                pp.wallet_paid,
                pp.total_price,
                pp.admin_earnings,
                pp.clinic_earnings,
                pp.subtotal,
                pp.vat_amount,
                pp.created_at AS purchase_date,
                pp.shipped_date,
                pp.delivered_date,
                pp.shipment_status,
                u.user_id,
                u.full_name AS user_name,
                u.email AS user_email,
                u.mobile_number,
                a.address,
                r.role,
                d.doctor_id,
                COUNT(*) OVER() AS total_count
            FROM tbl_product_purchase pp
            LEFT JOIN tbl_users u ON pp.user_id = u.user_id
            LEFT JOIN tbl_address a ON pp.address_id = a.address_id
            LEFT JOIN tbl_carts c ON pp.cart_id = c.cart_id
            LEFT JOIN tbl_clinics cl ON c.clinic_id = cl.clinic_id
            LEFT JOIN tbl_zqnq_users zu ON cl.zynq_user_id = zu.id
            LEFT JOIN tbl_doctors d ON d.zynq_user_id = zu.id
            LEFT JOIN tbl_roles r ON zu.role_id = r.id
            ORDER BY pp.created_at DESC
        `;

        // 2️⃣ Apply pagination if page & limit are provided
        if (page && limit) {
            const offset = (page - 1) * limit;
            purchaseQuery += ` LIMIT ${limit} OFFSET ${offset}`;
        }

        // 3️⃣ Fetch purchases
        const purchaseRows = await db.query(purchaseQuery);
        if (!purchaseRows.length) return [];

        // 4️⃣ Collect all product IDs
        const allProductIds = new Set();
        const parsedPurchases = purchaseRows.map(row => {
            const products = Array.isArray(row.product_details)
                ? row.product_details
                : JSON.parse(row.product_details || "[]");
            products.forEach(p => allProductIds.add(p.product_id));
            return { ...row, products }; // no total_count here
        });

        const productRows = allProductIds.size
            ? await db.query(
                `SELECT * FROM tbl_products WHERE product_id IN (?)`,
                [[...allProductIds]]
            )
            : [];
        const productInfoMap = productRows.reduce((map, p) => {
            map[p.product_id] = p;
            return map;
        }, {});

        const allClinicIds = [...new Set(productRows.map(p => p.clinic_id).filter(Boolean))];
        const clinicRows = allClinicIds.length
            ? await db.query(
                `SELECT clinic_id, clinic_name, address, clinic_logo 
                   FROM tbl_clinics WHERE clinic_id IN (?)`,
                [allClinicIds]
            )
            : [];
        const clinicMap = clinicRows.reduce((map, c) => {
            map[c.clinic_id] = c;
            return map;
        }, {});

        const imageRows = allProductIds.size
            ? await get_product_images_by_product_ids([...allProductIds])
            : [];
        const imagesMap = imageRows.reduce((map, row) => {
            if (!map[row.product_id]) map[row.product_id] = [];
            map[row.product_id].push(
                row.image.startsWith('http') ? row.image : `${APP_URL}clinic/product_image/${row.image}`
            );
            return map;
        }, {});

        const treatmentsRows = allProductIds.size
            ? await getTreatmentsOfProductsBulk([...allProductIds])
            : [];
        const treatmentsMap = treatmentsRows.reduce((map, t) => {
            if (!map[t.product_id]) map[t.product_id] = [];
            map[t.product_id].push(t);
            return map;
        }, {});

        const purchases = parsedPurchases.map(row => {
            const user = {
                user_id: row.user_id,
                name: row.user_name || null,
                email: row.user_email || null,
                mobile_number: row.mobile_number || null,
            };

            const enrichedProducts = row.products.map(p => {
                const prodInfo = productInfoMap[p.product_id] || {};
                return {
                    ...p,
                    ...prodInfo,
                    treatments: treatmentsMap[p.product_id] || [],
                    product_images: imagesMap[p.product_id] || [],
                };
            });

            const clinic_id = enrichedProducts[0]?.clinic_id || null;
            const clinic = clinicMap[clinic_id] || null;

            const commission_percentage =
                row.total_price > 0
                    ? (row.admin_earnings / row.total_price) * 100
                    : 0;

            return {
                purchase_id: row.purchase_id,
                purchase_type: "PRODUCT",
                cart_id: row.cart_id,
                doctor_id: row.doctor_id,
                wallet_paid: row.wallet_paid,
                purchase_date: row.purchase_date,
                shipped_date: row.shipped_date || null,
                delivered_date: row.delivered_date || null,
                total_price: row.total_price,
                admin_earnings: row.admin_earnings,
                clinic_earnings: row.clinic_earnings,
                subtotal: row.subtotal,
                vat_amount: row.vat_amount,
                commission_percentage: commission_percentage.toFixed(2),
                address: row.address,
                shipment_status: row.shipment_status,
                role: row.role,
                clinic,
                user,
                products: enrichedProducts,
                total_count: row.total_count,
            };
        });

        return purchases;
    } catch (error) {
        console.error("Failed to fetch admin purchased product data:", error);
        throw error;
    }
};

export const getAdminCartProductModel = async () => {
    try {
        const query = `
            SELECT * FROM tbl_product_purchase ORDER BY created_at DESC
        `;
        const results = await db.query(query);
        return results;
    } catch (error) {
        console.error("Failed to fetch purchase products data:", error);
        throw error;
    }
};

export const getSingleAdminPurchasedProductModel = async (purchase_id) => {
    try {
        const baseQuery = `
        SELECT
            pp.purchase_id,
            pp.cart_id,
            pp.product_details,
            pp.wallet_paid,
            pp.total_price,
            pp.admin_earnings,
            pp.clinic_earnings,
            pp.subtotal,
            pp.vat_amount,
            pp.created_at AS purchase_date,
            pp.shipped_date,
            pp.delivered_date,
            pp.shipment_status,
            u.user_id,
            u.full_name AS user_name,
            u.email AS user_email,
            u.mobile_number,
            a.address,
            r.role,
            d.doctor_id
        FROM tbl_product_purchase pp
        LEFT JOIN tbl_users u       ON pp.user_id = u.user_id
        LEFT JOIN tbl_address a     ON pp.address_id = a.address_id
        LEFT JOIN tbl_carts c       ON pp.cart_id = c.cart_id
        LEFT JOIN tbl_clinics cl    ON c.clinic_id = cl.clinic_id
        LEFT JOIN tbl_zqnq_users zu ON cl.zynq_user_id = zu.id
        LEFT JOIN tbl_doctors d     ON d.zynq_user_id = zu.id
        LEFT JOIN tbl_roles r       ON zu.role_id = r.id
        WHERE pp.purchase_id = ?
        LIMIT 1
    `;

        const [row] = await db.query(baseQuery, [purchase_id]);
        if (!row) return null;

        // 2️⃣ Parse product_details and collect product IDs
        let products = [];
        try {
            products = Array.isArray(row.product_details)
                ? row.product_details
                : JSON.parse(row.product_details || "[]");
        } catch {
            products = [];
        }
        const productIds = [...new Set(products.map(p => p.product_id))];

        // 3️⃣ Fetch products, clinics, images, treatments
        const productRows = productIds.length
            ? await db.query(`SELECT * FROM tbl_products WHERE product_id IN (?)`, [productIds])
            : [];

        const productInfoMap = productRows.reduce((acc, p) => {
            acc[p.product_id] = p;
            return acc;
        }, {});

        const clinicIds = [...new Set(productRows.map(p => p.clinic_id).filter(Boolean))];
        const clinicRows = clinicIds.length
            ? await db.query(
                `SELECT clinic_id, clinic_name, address, clinic_logo 
           FROM tbl_clinics WHERE clinic_id IN (?)`,
                [clinicIds]
            )
            : [];
        const clinicMap = clinicRows.reduce((acc, c) => {
            acc[c.clinic_id] = c;
            return acc;
        }, {});

        const imageRows = productIds.length
            ? await get_product_images_by_product_ids(productIds)
            : [];
        const imagesMap = imageRows.reduce((acc, img) => {
            if (!acc[img.product_id]) acc[img.product_id] = [];
            acc[img.product_id].push(
                img.image.startsWith("http")
                    ? img.image
                    : `${APP_URL}clinic/product_image/${img.image}`
            );
            return acc;
        }, {});

        const treatmentRows = productIds.length
            ? await getTreatmentsOfProductsBulk(productIds)
            : [];
        const treatmentsMap = treatmentRows.reduce((acc, t) => {
            if (!acc[t.product_id]) acc[t.product_id] = [];
            acc[t.product_id].push(t);
            return acc;
        }, {});

        // 4️⃣ Enrich products
        const enrichedProducts = products.map(p => {
            const info = productInfoMap[p.product_id] || {};
            return {
                ...p, // snapshot info (price, name, etc.)
                ...info,
                treatments: treatmentsMap[p.product_id] || [],
                product_images: imagesMap[p.product_id] || [],
            };
        });

        // 5️⃣ Clinic info (from first product)
        const clinic_id = enrichedProducts[0]?.clinic_id || null;
        const clinic = clinicMap[clinic_id] || null;

        // 6️⃣ Commission %
        const commission_percentage =
            row.total_price > 0
                ? ((row.admin_earnings || 0) / row.total_price) * 100
                : 0;

        // 7️⃣ Build final response
        return {
            purchase_id: row.purchase_id,
            purchase_type: "PRODUCT",
            cart_id: row.cart_id,
            doctor_id: row.doctor_id,
            wallet_paid: row.wallet_paid,
            purchase_date: row.purchase_date,
            shipped_date: row.shipped_date || null,
            delivered_date: row.delivered_date || null,
            total_price: row.total_price,
            admin_earnings: row.admin_earnings,
            clinic_earnings: row.clinic_earnings,
            subtotal: row.subtotal,
            vat_amount: row.vat_amount,
            commission_percentage: commission_percentage.toFixed(2),
            address: row.address,
            shipment_status: row.shipment_status,
            role: row.role,
            clinic,
            user: {
                user_id: row.user_id,
                name: row.user_name || null,
                email: row.user_email || null,
                mobile_number: row.mobile_number || null,
            },
            products: enrichedProducts,
            total_count: 1,
        };
    } catch (err) {
        console.error("Failed to fetch single admin purchased product:", err);
        throw err;
    }
};

export const getSingleAdminCartProductModel = async (purchase_id) => {
    try {
        const query = `
            SELECT * 
            FROM tbl_product_purchase 
            WHERE purchase_id = ?
            ORDER BY created_at DESC
        `;
        const results = await db.query(query, [purchase_id]);
        return results;
    } catch (error) {
        console.error("Failed to fetch purchase products data:", error);
        throw error;
    }
};

export const getAdminCommissionRatesModel = async () => {
    try {
        const query = `
      SELECT appointment_commission AS APPOINTMENT_COMMISSION, product_commission AS PRODUCT_COMMISSION  FROM tbl_admin ORDER BY created_at DESC
    `;
        const results = await db.query(query);
        return results;
    } catch (error) {
        console.error("Failed to fetch commission rates data:", error);
        throw error;
    }
}

export const updateAdminCommissionRatesModel = async ({ APPOINTMENT_COMMISSION, PRODUCT_COMMISSION }) => {
    try {
        const fields = [];
        const values = [];

        if (APPOINTMENT_COMMISSION !== undefined) {
            fields.push('appointment_commission = ?');
            values.push(APPOINTMENT_COMMISSION);
        }

        if (PRODUCT_COMMISSION !== undefined) {
            fields.push('product_commission = ?');
            values.push(PRODUCT_COMMISSION);
        }

        if (fields.length === 0) return { affectedRows: 0 };

        const query = `
            UPDATE tbl_admin
            SET ${fields.join(', ')}
            LIMIT 1
        `;

        const result = await db.query(query, values);
        return result;
    } catch (error) {
        console.error("❌ Database Error in updateAdminCommissionRatesModel:", error.message);
        throw new Error("Failed to update admin commission rates");
    }
};

export const getAppointmentsById = async (appointment_id) => {
    const results = await db.query(`
        SELECT  *
        FROM tbl_appointments 
        WHERE appointment_id = ?
    `, [appointment_id]);

    return results;
};


export const getTreatmentsOfProducts = async (product_id) => {
    try {
        const query = `
            SELECT 
                t.treatment_id,
                t.name,
                t.swedish,
                t.classification_type,
                t.created_at,
                t.benefits_en,
                t.benefits_sv,
                t.description_en,
                t.description_sv,
                t.source,
                t.is_device,
                t.is_admin_created,
                t.approval_status,
                t.is_deleted,

                st.sub_treatment_id,
                stm.name AS sub_treatment_name_en,
                stm.swedish AS sub_treatment_name_sv

            FROM tbl_product_treatments pt
            LEFT JOIN tbl_treatments t 
                ON t.treatment_id = pt.treatment_id
            LEFT JOIN tbl_treatment_sub_treatments st 
                ON st.treatment_id = t.treatment_id
            LEFT JOIN tbl_sub_treatment_master stm
                ON stm.sub_treatment_id = st.sub_treatment_id
            WHERE pt.product_id = ?;
        `;

        const rows = await db.query(query, [product_id]);

        const treatmentMap = {};

        for (const row of rows) {
            const treatmentId = row.treatment_id;

            // Create parent treatment object once
            if (!treatmentMap[treatmentId]) {
                treatmentMap[treatmentId] = {
                    ...row,
                    sub_treatments: []
                };

                delete treatmentMap[treatmentId].embeddings;
                delete treatmentMap[treatmentId].name_embeddings;
            }

            // Add sub-treatment (if exists)
            if (row.sub_treatment_id) {
                treatmentMap[treatmentId].sub_treatments.push({
                    sub_treatment_id: row.sub_treatment_id,
                    sub_treatment_name_en: row.sub_treatment_name_en,
                    sub_treatment_name_sv: row.sub_treatment_name_sv
                });
            }
        }

        return Object.values(treatmentMap);

    } catch (error) {
        console.error("Failed to fetch product treatments:", error);
        throw error;
    }
};

export const getTreatmentsOfProductsBulk = async (productIds) => {
    try {
        // Ensure we have an array
        if (!Array.isArray(productIds)) productIds = [productIds];

        // If no IDs, return empty
        if (productIds.length === 0) return [];

        const query = `
            SELECT pt.product_id, t.*
            FROM tbl_product_treatments pt
            JOIN tbl_treatments t 
                ON t.treatment_id = pt.treatment_id
            WHERE pt.product_id IN (?)
        `;

        const results = await db.query(query, [productIds]);

        // Remove embeddings from each treatment dynamically
        const cleanedResults = results.map(row => {
            const treatmentRow = { ...row };
            if ('embeddings' in treatmentRow) delete treatmentRow.embeddings;
            return treatmentRow;
        });

        return cleanedResults;
    } catch (error) {
        console.error("Failed to fetch treatments for products:", error);
        throw error;
    }
};

export const addWalletAmountModel = async (user_id, user_type, amount) => {
    try {
        let wallet_id = null;
        // Check if wallet exists
        const [wallet] = await db.query(
            `SELECT wallet_id, amount 
            FROM zynq_users_wallets 
            WHERE user_id = ? AND user_type = ? 
            LIMIT 1`,
            [user_id, user_type]
        );

        if (isEmpty(wallet)) {
            await db.query(
                `INSERT INTO zynq_users_wallets (user_id, user_type, amount) 
                VALUES (?, ?, ?)`,
                [user_id, user_type, amount]
            );

            const [newWallet] = await db.query(
                `SELECT wallet_id, amount 
                FROM zynq_users_wallets 
                WHERE user_id = ? AND user_type = ? 
                LIMIT 1`,
                [user_id, user_type]
            );

            wallet_id = newWallet.wallet_id;

        } else {
            const newAmount = parseFloat(wallet.amount) + parseFloat(amount);
            await db.query(
                `UPDATE zynq_users_wallets 
                SET amount = ? 
                WHERE wallet_id = ?`,
                [newAmount, wallet.wallet_id]
            );
            wallet_id = wallet.wallet_id;
        }

        return wallet_id;

    } catch (error) {
        console.error("addWalletAmountModel error:", error);
        throw error;
    }
};

export const updateWalletHistoryModel = async (wallet_id, amount, order_type, order_id) => {
    try {
        await db.query(
            `INSERT INTO zynq_user_wallet_history (wallet_id, amount, order_type, order_id) 
            VALUES (?, ?, ?, ?)`,
            [wallet_id, amount, order_type, order_id]
        );
    } catch (error) {
        console.error("updateWalletHistoryModel error:", error);
        throw error;
    }
}

export const updateOrderModel = async (order_type, order_id) => {
    try {
        if (order_type === "APPOINTMENT") {
            await db.query(
                `UPDATE tbl_appointments 
                SET wallet_paid = 1
                WHERE appointment_id = ?`,
                [order_id]
            )
        }
        if (order_type === "PURCHASE") {
            await db.query(
                `UPDATE tbl_product_purchase
                SET wallet_paid = 1
                WHERE purchase_id = ?
                `, [order_id]
            )
        }

    } catch (error) {
        console.error(" error:", error);
        throw error;
    }
}

export const updateRatingStatusModel = async (appointment_rating_id, approval_status) => {
    try {
        await db.query(
            `UPDATE tbl_appointment_ratings 
            SET approval_status = ? 
            WHERE appointment_rating_id = ?`,
            [approval_status, appointment_rating_id]
        );
        return await db.query(
            `SELECT user_id, appointment_id, doctor_id
            FROM tbl_appointment_ratings 
            WHERE appointment_rating_id = ?`,
            [appointment_rating_id]
        );

    } catch (error) {
        console.error("updateRatingStatusModel error:", error);
        throw error;
    }
}

export const getPurchasedProductModelForIds = async ({
    page,
    limit,
    purchaseIds = [],
} = {}) => {
    try {
        // 1️⃣ If ids provided but empty => return []
        if (Array.isArray(purchaseIds) && purchaseIds.length === 0) return [];

        // 2️⃣ Base query
        let purchaseQuery = `
        SELECT 
            pp.purchase_id,
            pp.cart_id,
            pp.product_details, 
            pp.wallet_paid,
            pp.total_price,
            pp.admin_earnings,
            pp.clinic_earnings,
            pp.created_at AS purchase_date,
            pp.shipped_date,
            pp.delivered_date,
            pp.shipment_status,
            u.user_id,
            u.full_name AS user_name,
            u.email AS user_email,
            u.mobile_number,
            a.address,
            r.role,
            d.doctor_id,
            COUNT(*) OVER() AS total_count
        FROM tbl_product_purchase pp
        LEFT JOIN tbl_users u ON pp.user_id = u.user_id
        LEFT JOIN tbl_address a ON pp.address_id = a.address_id
        LEFT JOIN tbl_carts c ON pp.cart_id = c.cart_id
        LEFT JOIN tbl_clinics cl ON c.clinic_id = cl.clinic_id
        LEFT JOIN tbl_zqnq_users zu ON cl.zynq_user_id = zu.id
        LEFT JOIN tbl_doctors d ON d.zynq_user_id = zu.id
        LEFT JOIN tbl_roles r ON zu.role_id = r.id
    `;

        // 3️⃣ Apply filter by IDs if provided
        const whereClauses = [];
        if (purchaseIds?.length) {
            whereClauses.push(`pp.purchase_id IN (?)`);
        }
        if (whereClauses.length) {
            purchaseQuery += ` WHERE ${whereClauses.join(" AND ")}`;
        }

        purchaseQuery += ` ORDER BY pp.created_at DESC`;

        // 4️⃣ Pagination only if ids not passed
        if (!purchaseIds?.length && page && limit) {
            const offset = (page - 1) * limit;
            purchaseQuery += ` LIMIT ${limit} OFFSET ${offset}`;
        }

        const purchaseRows = await db.query(purchaseQuery, purchaseIds?.length ? [purchaseIds] : []);

        if (!purchaseRows.length) return [];

        // === enrichment (same as your original code) ===
        const allProductIds = new Set();
        const parsedPurchases = purchaseRows.map(row => {
            const products = Array.isArray(row.product_details)
                ? row.product_details
                : JSON.parse(row.product_details || "[]");
            products.forEach(p => allProductIds.add(p.product_id));
            return { ...row, products };
        });

        const productRows = allProductIds.size
            ? await db.query(`SELECT * FROM tbl_products WHERE product_id IN (?)`, [[...allProductIds]])
            : [];

        const productInfoMap = productRows.reduce((map, p) => {
            map[p.product_id] = p;
            return map;
        }, {});

        const allClinicIds = [...new Set(productRows.map(p => p.clinic_id).filter(Boolean))];
        const clinicRows = allClinicIds.length
            ? await db.query(
                `SELECT clinic_id, clinic_name, address, clinic_logo FROM tbl_clinics WHERE clinic_id IN (?)`,
                [allClinicIds]
            )
            : [];
        const clinicMap = clinicRows.reduce((map, c) => {
            map[c.clinic_id] = c;
            return map;
        }, {});

        const imageRows = allProductIds.size
            ? await get_product_images_by_product_ids([...allProductIds])
            : [];
        const imagesMap = imageRows.reduce((map, row) => {
            if (!map[row.product_id]) map[row.product_id] = [];
            map[row.product_id].push(
                row.image.startsWith("http") ? row.image : `${APP_URL}clinic/product_image/${row.image}`
            );
            return map;
        }, {});

        const treatmentsRows = allProductIds.size
            ? await getTreatmentsOfProductsBulk([...allProductIds])
            : [];
        const treatmentsMap = treatmentsRows.reduce((map, t) => {
            if (!map[t.product_id]) map[t.product_id] = [];
            map[t.product_id].push(t);
            return map;
        }, {});

        return parsedPurchases.map(row => {
            const user = {
                user_id: row.user_id,
                name: row.user_name || null,
                email: row.user_email || null,
                mobile_number: row.mobile_number || null,
            };

            const enrichedProducts = row.products.map(p => {
                const prodInfo = productInfoMap[p.product_id] || {};
                return {
                    ...p,
                    ...prodInfo,
                    treatments: treatmentsMap[p.product_id] || [],
                    product_images: imagesMap[p.product_id] || [],
                };
            });

            const clinic_id = enrichedProducts[0]?.clinic_id || null;
            const clinic = clinicMap[clinic_id] || null;

            const commission_percentage =
                row.total_price > 0 ? (row.admin_earnings / row.total_price) * 100 : 0;

            return {
                purchase_id: row.purchase_id,
                purchase_type: "PRODUCT",
                cart_id: row.cart_id,
                doctor_id: row.doctor_id,
                wallet_paid: row.wallet_paid,
                purchase_date: row.purchase_date,
                shipped_date: row.shipped_date || null,
                delivered_date: row.delivered_date || null,
                total_price: row.total_price,
                admin_earnings: row.admin_earnings,
                clinic_earnings: row.clinic_earnings,
                commission_percentage: commission_percentage.toFixed(2),
                address: row.address,
                shipment_status: row.shipment_status,
                role: row.role,
                clinic,
                user,
                products: enrichedProducts,
                total_count: row.total_count,
            };
        });
    } catch (error) {
        console.error("Failed to fetch purchased product data:", error);
        throw error;
    }
};

export const getBookedAppointmentsModelForIds = async ({
    page,
    limit,
    appointmentIds = [],
} = {}) => {
    try {
        // 1️⃣ Early exit for empty ids
        if (Array.isArray(appointmentIds) && appointmentIds.length === 0) return [];

        let query = `
        SELECT
            a.*,
            d.name AS doctor_name,
            zu.email AS doctor_email,
            c.clinic_name,
            r.role,
            u.full_name AS user_name,
            u.mobile_number AS user_mobile,
            CASE 
                WHEN a.total_price > 0 
                    THEN ROUND((a.admin_earnings / a.total_price) * 100, 2) 
                ELSE 0 
            END AS commission_percentage,
            COALESCE(
                (
                    SELECT JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'treatment_id', at.treatment_id,
                            'treatment_name', t.name,
                            'treatment_price', at.price
                        )
                    )
                    FROM tbl_appointment_treatments at
                    LEFT JOIN tbl_treatments t ON t.treatment_id = at.treatment_id
                    WHERE at.appointment_id = a.appointment_id
                      AND at.treatment_id IS NOT NULL
                ),
                JSON_ARRAY()
            ) AS treatments,
            COUNT(*) OVER() AS total_count
        FROM tbl_appointments a
        LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
        LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
        LEFT JOIN tbl_clinics c ON c.clinic_id = a.clinic_id
        LEFT JOIN tbl_users u ON u.user_id = a.user_id
        LEFT JOIN tbl_zqnq_users zu2 ON zu2.id = d.zynq_user_id
        LEFT JOIN tbl_roles r ON zu2.role_id = r.id
        WHERE a.save_type = 'booked' 
          AND a.total_price > 0 
          AND a.payment_status != 'unpaid'
    `;

        // 2️⃣ Filter by ids if provided
        if (appointmentIds?.length) {
            query += ` AND a.appointment_id IN (?)`;
        }

        query += ` ORDER BY a.created_at DESC`;

        // 3️⃣ Pagination only if ids not passed
        if (!appointmentIds?.length && page && limit) {
            const offset = (page - 1) * limit;
            query += ` LIMIT ${limit} OFFSET ${offset}`;
        }

        const rows = await db.query(query, appointmentIds?.length ? [appointmentIds] : []);

        if (!rows.length) return [];

        return rows.map(r => ({ ...r, total_count: r.total_count }));
    } catch (error) {
        console.error("Failed to fetch booked appointments:", error);
        throw error;
    }
};

export const checkExistingWalletHistoryModel = async (order_type, order_id) => {
    try {
        return await db.query(
            `SELECT * 
            FROM zynq_user_wallet_history 
            WHERE order_type = ? AND order_id = ?`,
            [order_type, order_id]
        );
    } catch (error) {
        console.error("checkExistingWalletHistoryModel error:", error);
        throw error;
    }
}

export const updateUserApprovalStatus = async (user_id, approval_status) => {
    try {
        return await db.query(
            `UPDATE tbl_users SET approval_status = ? WHERE user_id = ?`,
            [approval_status, user_id]
        );
    } catch (error) {
        console.error("updateUserApprovalStatus error:", error);
        throw error;
    }
}

export const insertClinics = async (clinics) => {
    if (!clinics.length) return;

    const placeholders = clinics.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");

    return db.query(
        `
        INSERT INTO tbl_clinics
        (clinic_name, org_number, email, mobile_number, address, onboarding_token, is_invited)
        VALUES ${placeholders}
        `,
        clinics.flat()
    );
};

export const updateZynqUserApprovalStatus = async (userData, status) => {
    try {
        const { role, user_id, zynq_user_id } = userData;

        const updates = [];

        if (role === 'CLINIC') {
            updates.push({
                table: 'tbl_clinics',
                idField: 'clinic_id',
                idValue: user_id,
            });
        } else if (role === 'DOCTOR' || role === 'SOLO_DOCTOR') {
            updates.push({
                table: 'tbl_doctors',
                idField: 'doctor_id',
                idValue: user_id,
            });

            if (role === 'SOLO_DOCTOR') {
                updates.push({
                    table: 'tbl_clinics',
                    idField: 'zynq_user_id',
                    idValue: zynq_user_id,
                });
            }
        }

        if (updates.length === 0) {
            console.warn(`No matching table for role: ${role}`);
            return;
        }

        await Promise.all(
            updates.map(({ table, idField, idValue }) =>
                db.query(
                    `UPDATE ${table} SET profile_status = ? WHERE ${idField} = ?`,
                    [status, idValue]
                )
            )
        );

    } catch (error) {
        console.error("updateZynqUserApprovalStatus error:", error);
        throw new Error("Failed to update profile status");
    }
};

export const getZynqUserData = async (zynq_user_id) => {
    try {
        const query = `
            SELECT 
                zu.id AS zynq_user_id,
                r.role,
                CASE 
                    WHEN r.role IN ('DOCTOR', 'SOLO_DOCTOR') THEN d.doctor_id
                    WHEN r.role = 'CLINIC' THEN c.clinic_id
                    ELSE NULL
                END AS user_id,
                zu.*,
                r.*
            FROM tbl_zqnq_users zu
            LEFT JOIN tbl_roles r ON zu.role_id = r.id
            LEFT JOIN tbl_doctors d ON (r.role IN ('DOCTOR','SOLO_DOCTOR') AND d.zynq_user_id = zu.id)
            LEFT JOIN tbl_clinics c ON (r.role = 'CLINIC' AND c.zynq_user_id = zu.id)
            WHERE zu.id = ?;
        `;

        const result = await db.query(query, [zynq_user_id]);
        return result?.[0] || null;
    } catch (error) {
        console.error("getZynqUserData error:", error);
        throw new Error("Failed to fetch Zynq user data");
    }
};

export const updateProductApprovalStatus = async (product_id, approval_status) => {
    try {
        await db.query(
            `UPDATE tbl_products SET approval_status = ? WHERE product_id = ?`,
            [approval_status, product_id]
        );

        return await db.query(
            `SELECT p.clinic_id, r.role, d.doctor_id
            FROM tbl_products p
            LEFT JOIN tbl_clinics c ON p.clinic_id = c.clinic_id
            LEFT JOIN tbl_zqnq_users zu ON c.zynq_user_id = zu.id
            LEFT JOIN tbl_doctors d ON d.zynq_user_id = zu.id
            LEFT JOIN tbl_roles r ON zu.role_id = r.id
            WHERE p.product_id = ?`,
            [product_id]
        );

    } catch (error) {
        console.error("updateProductApprovalStatus error:", error);
        throw error;
    }
}
export const get_treatments_count = async (search = "") => {
    try {
        let whereClause = "is_deleted = 0";
        const params = [];
        if (search) {
            whereClause += " AND (name LIKE ? OR swedish LIKE ? OR description_en LIKE ? OR description_sv LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }
        const sql = `SELECT COUNT(*) AS count FROM tbl_treatments WHERE ${whereClause};`;
        const result = await db.query(sql, params);
        return result[0]?.count || 0;
    } catch (error) {
        console.error("get_treatments_count error:", error);
        throw error;
    }
};

export const getAllTreatmentsModel = async (limit, offset, search = "", sortBy = "created_at", sortOrder = "DESC") => {
    try {
        const allowedSortColumns = {
            name: 't.name',
            swedish: 't.swedish',
            classification_type: 't.classification_type',
            created_at: 't.created_at',
            approval_status: 't.approval_status'
        };
        const orderByCol = allowedSortColumns[sortBy] || 't.created_at';
        const orderDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        let whereClause = "t.is_deleted = 0";
        const params = [];

        if (search) {
            whereClause += " AND (t.name LIKE ? OR t.swedish LIKE ? OR t.description_en LIKE ? OR t.description_sv LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }

        let query = `
            SELECT
                t.treatment_id,
                t.name,
                t.swedish,
                t.classification_type,
                t.description_en,
                t.description_sv,
                t.technology,
                t.type,
                t.source,
                t.application,
                t.is_device,
                t.is_admin_created,
                t.created_by_zynq_user_id,
                t.approval_status,
                t.is_deleted,
                t.created_at,
            
                lw.like_wise_terms_ids,
                lw.like_wise_terms,
                lw.like_wise_terms_swedish,
            
                c.concern_ids,
                c.concern_name,
                c.concern_name_swedish,
            
                d.device_name_ids,
                d.device_name,
                d.device_name_swedish,
            
                b.benefits_en_ids,
                b.benefits_en,
                b.benefits_sv,
            
                st.sub_treatment_ids
            FROM tbl_treatments t
            LEFT JOIN (
                SELECT
                    tlwt.treatment_id,
                    GROUP_CONCAT(DISTINCT lwt.like_wise_term_id SEPARATOR ',') AS like_wise_terms_ids,
                    GROUP_CONCAT(DISTINCT lwt.name SEPARATOR ',') AS like_wise_terms,
                    GROUP_CONCAT(DISTINCT lwt.swedish SEPARATOR ',') AS like_wise_terms_swedish
                FROM tbl_treatment_like_wise_terms tlwt
                JOIN tbl_likewise_terms lwt ON lwt.like_wise_term_id = tlwt.like_wise_term_id AND lwt.is_deleted = 0 AND lwt.approval_status = 'APPROVED'
                GROUP BY tlwt.treatment_id
            ) lw ON lw.treatment_id = t.treatment_id
            LEFT JOIN (
                SELECT
                    tc.treatment_id,
                    GROUP_CONCAT(DISTINCT c.concern_id SEPARATOR ',') AS concern_ids,
                    GROUP_CONCAT(DISTINCT c.name SEPARATOR ',') AS concern_name,
                    GROUP_CONCAT(DISTINCT c.swedish SEPARATOR ',') AS concern_name_swedish
                FROM tbl_treatment_concerns tc
                JOIN tbl_concerns c ON c.concern_id = tc.concern_id AND c.is_deleted = 0 AND c.approval_status = 'APPROVED'
                GROUP BY tc.treatment_id
            ) c ON c.treatment_id = t.treatment_id
            LEFT JOIN (
                SELECT
                    d.treatment_id,
                    GROUP_CONCAT(DISTINCT tbd.device_id SEPARATOR ',') AS device_name_ids,
                    GROUP_CONCAT(DISTINCT tbd.name SEPARATOR ',') AS device_name,
                    GROUP_CONCAT(DISTINCT tbd.swedish SEPARATOR ',') AS device_name_swedish
                FROM tbl_treatment_devices d
                JOIN tbl_devices tbd ON tbd.device_id = d.device_id AND tbd.is_deleted = 0 AND tbd.approval_status = 'APPROVED'
                GROUP BY d.treatment_id
            ) d ON d.treatment_id = t.treatment_id
            LEFT JOIN (
                SELECT
                    ttb.treatment_id,
                    GROUP_CONCAT(DISTINCT tb.benefit_id SEPARATOR ',') AS benefits_en_ids,
                    GROUP_CONCAT(DISTINCT tb.name SEPARATOR ',') AS benefits_en,
                    GROUP_CONCAT(DISTINCT tb.swedish SEPARATOR ',') AS benefits_sv
                FROM tbl_treatment_benefits ttb
                JOIN tbl_benefits tb ON tb.benefit_id = ttb.benefit_id AND tb.is_deleted = 0 AND tb.approval_status = 'APPROVED'
                GROUP BY ttb.treatment_id
            ) b ON b.treatment_id = t.treatment_id
            LEFT JOIN (
                SELECT
                    ttstum.treatment_id,
                    GROUP_CONCAT(DISTINCT ttstum.sub_treatment_id SEPARATOR ',') AS sub_treatment_ids
                FROM tbl_treatment_sub_treatments ttstum
                GROUP BY ttstum.treatment_id
            ) st ON st.treatment_id = t.treatment_id
            WHERE ${whereClause}
            ORDER BY ${orderByCol} ${orderDir}
        `;

        if (limit !== undefined && offset !== undefined) {
            query += ` LIMIT ? OFFSET ?`;
            params.push(limit, offset);
        }

        return await db.query(query, params);
    } catch (error) {
        console.error("getAllTreatmentsModel error:", error);
        throw error;
    }
};

export const getTreatmentsByZynqUserId = async (zynq_user_id) => {
    console.log("user id =>", zynq_user_id)
    try {
        const query = `
SELECT
    t.treatment_id,
    t.name,
    t.swedish,
    t.classification_type,
    t.description_en,
    t.description_sv,
    t.technology,
    t.type,
    t.source,
    t.application,
    t.is_device,
    t.is_admin_created,
    t.created_by_zynq_user_id,
    t.approval_status,
    t.is_deleted,
    t.created_at,

    lw.like_wise_terms,
    lw.like_wise_terms_swedish,

    c.concern_ids,
    c.concern_name,
    c.concern_name_swedish,

    d.device_name,
    d.device_name_swedish,

    b.benefits_en,
    b.benefits_sv,

    st.sub_treatment_ids

FROM tbl_treatments t

/* -------------------- Like-wise terms -------------------- */
LEFT JOIN (
    SELECT
        tlwt.treatment_id,
        GROUP_CONCAT(DISTINCT lwt.name SEPARATOR ',') AS like_wise_terms,
        GROUP_CONCAT(DISTINCT lwt.swedish SEPARATOR ',') AS like_wise_terms_swedish
    FROM tbl_treatment_like_wise_terms tlwt
    JOIN tbl_likewise_terms lwt
        ON lwt.like_wise_term_id = tlwt.like_wise_term_id
       AND lwt.is_deleted = 0
       AND lwt.approval_status = 'APPROVED'
    GROUP BY tlwt.treatment_id
) lw ON lw.treatment_id = t.treatment_id

/* -------------------- Concerns -------------------- */
LEFT JOIN (
    SELECT
        tc.treatment_id,
        GROUP_CONCAT(DISTINCT c.concern_id SEPARATOR ',') AS concern_ids,
        GROUP_CONCAT(DISTINCT c.name SEPARATOR ',') AS concern_name,
        GROUP_CONCAT(DISTINCT c.swedish SEPARATOR ',') AS concern_name_swedish
    FROM tbl_treatment_concerns tc
    JOIN tbl_concerns c
        ON c.concern_id = tc.concern_id
       AND c.is_deleted = 0
       AND c.approval_status = 'APPROVED'
    GROUP BY tc.treatment_id
) c ON c.treatment_id = t.treatment_id

/* -------------------- Devices -------------------- */
LEFT JOIN (
    SELECT
        td.treatment_id,
        GROUP_CONCAT(DISTINCT d.name SEPARATOR ',') AS device_name,
        GROUP_CONCAT(DISTINCT d.swedish SEPARATOR ',') AS device_name_swedish
    FROM tbl_treatment_devices td
    JOIN tbl_devices d
        ON d.device_id = td.device_id
       AND d.is_deleted = 0
       AND d.approval_status = 'APPROVED'
    GROUP BY td.treatment_id
) d ON d.treatment_id = t.treatment_id

/* -------------------- Benefits -------------------- */
LEFT JOIN (
    SELECT
        tbm.treatment_id,
        GROUP_CONCAT(DISTINCT b.name SEPARATOR ',') AS benefits_en,
        GROUP_CONCAT(DISTINCT b.swedish SEPARATOR ',') AS benefits_sv
    FROM tbl_treatment_benefits tbm
    JOIN tbl_benefits b
        ON b.benefit_id = tbm.benefit_id
       AND b.is_deleted = 0
       AND b.approval_status = 'APPROVED'
    GROUP BY tbm.treatment_id
) b ON b.treatment_id = t.treatment_id

/* -------------------- Sub-treatments -------------------- */
LEFT JOIN (
    SELECT
        ttstum.treatment_id,
        GROUP_CONCAT(DISTINCT ttstum.sub_treatment_id SEPARATOR ',') AS sub_treatment_ids
    FROM tbl_treatment_sub_treatment_user_maps ttstum
    WHERE ttstum.zynq_user_id = ?
    GROUP BY ttstum.treatment_id
) st ON st.treatment_id = t.treatment_id

WHERE
    t.is_deleted = 0
    AND t.created_by_zynq_user_id = ?

ORDER BY
    t.created_at DESC;
        `;

        return await db.query(query, [zynq_user_id, zynq_user_id]);

    } catch (error) {
        console.error("getAllUsersTreatmentsModel error:", error);
        throw error;
    }
};

export const get_sub_treatment_master_count = async ({ search = "", status = "", isAdmin = false, zynq_user_id = null }) => {
    try {
        let conditions = "is_deleted = 0";
        const params = [];

        if (!isAdmin && zynq_user_id) {
            conditions += " AND (created_by = ? OR approval_status = 'APPROVED')";
            params.push(zynq_user_id);
        }

        if (status) {
            conditions += " AND approval_status = ?";
            params.push(status);
        }

        if (search) {
            conditions += " AND (name LIKE ? OR swedish LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        const sql = `SELECT COUNT(*) AS count FROM tbl_sub_treatment_master WHERE ${conditions};`;
        const result = await db.query(sql, params);
        return result[0]?.count || 0;
    } catch (error) {
        console.error("get_sub_treatment_master_count error:", error);
        throw error;
    }
};

export const getAllSubTreatmentsMasterModel = async ({ limit, offset, search = "", sortBy = "created_at", sortOrder = "DESC", status = "", isAdmin = false, zynq_user_id = null } = {}) => {
    try {
        let conditions = "is_deleted = 0";
        const params = [];

        if (!isAdmin && zynq_user_id) {
            conditions += " AND (created_by = ? OR approval_status = 'APPROVED')";
            params.push(zynq_user_id);
        }

        if (status) {
            conditions += " AND approval_status = ?";
            params.push(status);
        }

        if (search) {
            conditions += " AND (name LIKE ? OR swedish LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        const allowedSortColumns = {
            name: 'name',
            swedish: 'swedish',
            created_at: 'created_at',
            approval_status: 'approval_status'
        };
        const orderByCol = allowedSortColumns[sortBy] || 'created_at';
        const orderDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        let query = `
            SELECT 
                sub_treatment_id,
                name,
                swedish,
                approval_status,
                is_deleted,
                created_by,
                is_admin_created,
                created_at,
                updated_at
            FROM 
                tbl_sub_treatment_master
            WHERE 
                ${conditions}
            ORDER BY 
                ${orderByCol} ${orderDir}
        `;

        if (limit !== undefined && limit !== null && offset !== undefined && offset !== null) {
            query += ` LIMIT ? OFFSET ?`;
            params.push(limit, offset);
        }

        return await db.query(query, params);

    } catch (error) {
        console.error("getAllSubTreatmentsMasterModel error:", error);
        throw error;
    }
};
export const getTreatmentsByTreatmentId = async (treatment_id, zynq_user_id = null) => {
    try {
        let query = `
            SELECT
    t.treatment_id,
    t.name,
    t.swedish,
    t.classification_type,
    t.description_en,
    t.description_sv,
    t.technology,
    t.type,
    t.source,
    t.application,
    t.is_device,
    t.created_by_zynq_user_id,
    t.approval_status,
    t.is_deleted,
    t.embeddings,
    t.name_embeddings,
    t.created_at,

    c.concerns,

    l.like_wise_terms_ids,
    l.like_wise_terms,
    l.like_wise_terms_swedish,

    d.device_name_ids,
    d.device_name,
    d.device_name_swedish,

    b.benefits_en_ids,
    b.benefits_en,
    b.benefits_sv

FROM tbl_treatments t

/* ---------- CONCERNS ---------- */
LEFT JOIN (
    SELECT
        tc.treatment_id,
        JSON_ARRAYAGG(
            JSON_OBJECT(
                'concern_id', c.concern_id,
                'concern_name', c.name,
                'concern_swedish', c.swedish
            )
        ) AS concerns
    FROM (
        SELECT DISTINCT treatment_id, concern_id
        FROM tbl_treatment_concerns
    ) tc
    JOIN tbl_concerns c
        ON c.concern_id = tc.concern_id
    GROUP BY tc.treatment_id
) c ON c.treatment_id = t.treatment_id


/* ---------- LIKE WISE TERMS ---------- */
LEFT JOIN (
    SELECT
        tlwt.treatment_id,
        GROUP_CONCAT(DISTINCT lwt.like_wise_term_id ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms_ids,
        GROUP_CONCAT(DISTINCT lwt.name ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms,
        GROUP_CONCAT(DISTINCT lwt.swedish ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms_swedish
    FROM tbl_treatment_like_wise_terms tlwt
    JOIN tbl_likewise_terms lwt
        ON lwt.like_wise_term_id = tlwt.like_wise_term_id
       AND lwt.is_deleted = 0
       AND lwt.approval_status = 'APPROVED'
    GROUP BY tlwt.treatment_id
) l ON l.treatment_id = t.treatment_id


/* ---------- DEVICES ---------- */
LEFT JOIN (
    SELECT
        d.treatment_id,
        GROUP_CONCAT(DISTINCT tbd.device_id ORDER BY tbd.name SEPARATOR ',') AS device_name_ids,
        GROUP_CONCAT(DISTINCT tbd.name ORDER BY tbd.name SEPARATOR ',') AS device_name,
        GROUP_CONCAT(DISTINCT tbd.swedish ORDER BY tbd.name SEPARATOR ',') AS device_name_swedish
    FROM tbl_treatment_devices d
    JOIN tbl_devices tbd
        ON tbd.device_id = d.device_id
       AND tbd.is_deleted = 0
       AND tbd.approval_status = 'APPROVED'
    GROUP BY d.treatment_id
) d ON d.treatment_id = t.treatment_id


/* ---------- BENEFITS ---------- */
LEFT JOIN (
    SELECT
        ttb.treatment_id,
        GROUP_CONCAT(DISTINCT tb.benefit_id ORDER BY tb.name SEPARATOR ',') AS benefits_en_ids,
        GROUP_CONCAT(DISTINCT tb.name ORDER BY tb.name SEPARATOR ',') AS benefits_en,
        GROUP_CONCAT(DISTINCT tb.swedish ORDER BY tb.name SEPARATOR ',') AS benefits_sv
    FROM tbl_treatment_benefits ttb
    JOIN tbl_benefits tb
        ON tb.benefit_id = ttb.benefit_id
       AND tb.is_deleted = 0
       AND tb.approval_status = 'APPROVED'
    GROUP BY ttb.treatment_id
) b ON b.treatment_id = t.treatment_id


WHERE t.treatment_id = ?
  AND t.is_deleted = 0
        `;

        const params = [treatment_id];

        // If user (NOT admin), add user filter
        if (zynq_user_id) {
            query += ` AND t.created_by_zynq_user_id = ? `;
            params.push(zynq_user_id);
        }

        // query += ` GROUP BY t.treatment_id `;

        return await db.query(query, params);

    } catch (error) {
        console.error("getTreatmentsByTreatmentId error:", error);
        throw error;
    }
};

// export const getSubTreatmentsByTreatmentId = async (treatment_id) => {
//     try {
//         return await db.query(
//             `SELECT * FROM tbl_sub_treatments WHERE treatment_id = ? AND is_deleted = 0`,
//             [treatment_id]
//         );
//     } catch (error) {
//         console.error("getSubTreatmentsByTreatmentId error:", error);
//         throw error;
//     }
// };

export const getSubTreatmentsByTreatmentId = async (treatment_id) => {
    try {
        return await db.query(
            `SELECT 
                ttst.id,
                ttst.treatment_id,
                ttst.sub_treatment_id,
                tstm.name,
                tstm.swedish,
                tstm.approval_status
             FROM tbl_treatment_sub_treatments ttst
             JOIN tbl_sub_treatment_master tstm
                ON ttst.sub_treatment_id = tstm.sub_treatment_id
             WHERE ttst.treatment_id = ? 
               AND tstm.is_deleted = 0
               AND tstm.approval_status = 'APPROVED'`,
            [treatment_id]
        );
    } catch (error) {
        console.error("getSubTreatmentsByTreatmentId error:", error);
        throw error;
    }
};

export const getUserSubTreatmentsByTreatmentId = async (treatment_id, zynq_user_id) => {
    try {
        return await db.query(
            `SELECT 
                ttstum.id,
                ttstum.treatment_id,
                ttstum.sub_treatment_id,
                tstm.name,
                tstm.swedish,
                tstm.approval_status
             FROM tbl_treatment_sub_treatment_user_maps ttstum
             JOIN tbl_sub_treatment_master tstm
                ON ttstum.sub_treatment_id = tstm.sub_treatment_id
             WHERE ttstum.treatment_id = ?
               AND ttstum.zynq_user_id = ?
               AND tstm.is_deleted = 0
               AND tstm.approval_status = 'APPROVED'`,
            [treatment_id, zynq_user_id]
        );
    } catch (error) {
        console.error("getUserSubTreatmentsByTreatmentId error:", error);
        throw error;
    }
};


export const addTreatmentModel = async (data) => {
    try {
        return await db.query(
            `INSERT INTO tbl_treatments SET ?`,
            [data]
        );
    } catch (error) {
        console.error("addTreatmentModel error:", error);
        throw error;
    }
};

export const addSubTreatmentModel = async (data) => {
    try {
        return await db.query(
            `INSERT INTO tbl_sub_treatments SET ?`,
            [data]
        );
    } catch (error) {
        console.error("addSubTreatmentModel error:", error);
        throw error;
    }
};

export const addSubTreatmentMasterModel = async (data) => {
    try {
        return await db.query(
            `INSERT INTO tbl_sub_treatment_master SET ?`,
            [data]
        );
    } catch (error) {
        console.error("addSubTreatmentMasterModel error:", error);
        throw error;
    }
};

export const getSubTreatmentModel = async (treatment_id, name) => {
    try {
        const [rows] = await db.query(
            `SELECT * FROM tbl_sub_treatments 
             WHERE treatment_id = ? 
               AND name = ? 
               ORDER BY created_at desc`,
            [treatment_id, name,]
        );

        return rows; // return only array of results
    } catch (error) {
        console.error("getSubTreatmentModel error:", error);
        throw error;
    }
};

export const getSubTreatmentMasterByName = async (name) => {
    try {
        const [rows] = await db.query(
            `SELECT * FROM tbl_sub_treatment_master 
             WHERE name = ? 
               ORDER BY created_at desc`,
            [name,]
        );

        return rows; // return only array of results
    } catch (error) {
        console.error("getSubTreatmentMasterModel error:", error);
        throw error;
    }
};


export const updateTreatmentModel = async (treatment_id, data) => {
    try {
        return await db.query(
            `UPDATE tbl_treatments SET ? WHERE treatment_id = ?`,
            [data, treatment_id]
        );
    } catch (error) {
        console.error("updateTreatmentModel error:", error);
        throw error;
    }
};

export const updateSubtreatmentModel = async (sub_treatment_id, data) => {
    try {
        return await db.query(
            `UPDATE tbl_sub_treatments SET ? WHERE sub_treatment_id = ?`,
            [data, sub_treatment_id]
        );
    } catch (error) {
        console.error("updateTreatmentModel error:", error);
        throw error;
    }
};
export const updateSubtreatmentMasterModel = async (sub_treatment_id, data) => {
    try {
        return await db.query(
            `UPDATE tbl_sub_treatment_master SET ? WHERE sub_treatment_id = ?`,
            [data, sub_treatment_id]
        );
    } catch (error) {
        console.error("updateTreatmentMasterModel error:", error);
        throw error;
    }
};

export const addSubTreatmentUserMap = async (data) => {
    try {
        return await db.query(
            `INSERT INTO tbl_sub_treatment_user_maps SET ?`,
            [data]
        );
    } catch (error) {
        console.error("addSubTreatmentUserMap error:", error);
        throw error;
    }
};

export const updateSubTreatmentUserMap = async (sub_treatment_id, user_id, data) => {
    try {
        return await db.query(
            `UPDATE tbl_sub_treatment_user_maps 
             SET ? 
             WHERE sub_treatment_id = ? AND zynq_user_id = ?`,
            [data, sub_treatment_id, user_id]
        );
    } catch (error) {
        console.error("updateSubTreatmentUserMap error:", error);
        throw error;
    }
};

export const deleteExistingConcernsModel = async (treatment_id) => {
    try {
        return await db.query(
            `DELETE FROM tbl_treatment_concerns WHERE treatment_id = ?`,
            [treatment_id]
        );
    } catch (error) {
        console.error("deleteExistingConcernsModel error:", error);
        throw error;
    }
}

export const deleteTreatmentDeviceNameModel = async (treatment_id) => {
    try {
        return await db.query(
            `DELETE FROM tbl_treatment_devices WHERE treatment_id = ?`,
            [treatment_id]
        );
    } catch (error) {
        console.error("deleteTreatmentDeviceNameModel error:", error);
        throw error;
    }
};

export const deleteTreatmentSubTreatmentsModel = async (treatment_id) => {
    try {
        return await db.query(
            `DELETE FROM tbl_treatment_sub_treatments WHERE treatment_id = ?`,
            [treatment_id]
        );
    } catch (error) {
        console.error("deleteTreatmentSubTreatmentsModel error:", error);
        throw error;
    }
};


export const addTreatmentConcernsModel = async (treatment_id, concerns) => {
    try {
        const values = concerns.map(concern => [treatment_id, concern]);
        return await db.query(
            `INSERT INTO tbl_treatment_concerns (treatment_id, concern_id) VALUES ?`,
            [values]
        );
    } catch (error) {
        console.error("addTreatmentConcernsModel error:", error);
        throw error;
    }
};

export const addTreatmentDeviceNameModel = async (treatment_id, devices) => {
    try {
        const values = devices.map(device => [treatment_id, device]);
        return await db.query(
            `INSERT INTO tbl_treatment_devices (treatment_id, device_name) VALUES ?`,
            [values]
        );
    } catch (error) {
        console.error("addTreatmentDeviceNameModel error:", error);
        throw error;
    }
};

export const addTreatmentSubTreatmentModel = async (treatment_id, subTreatments) => {
    try {

        if (!treatment_id || !Array.isArray(subTreatments) || subTreatments.length === 0) {
            return [];
        }


        const values = subTreatments.map(sub => [treatment_id, sub]);

        return await db.query(
            `INSERT INTO tbl_treatment_sub_treatments (treatment_id, sub_treatment_id) VALUES ?`,
            [values]
        );
    } catch (error) {
        console.error("addTreatmentSubTreatmentModel error:", error);
        throw error;
    }
};

export const addTreatmentSubTreatmentUserModel = async (treatment_id, subTreatments, zynq_user_id) => {
    try {
        const values = subTreatments.map(sub => [treatment_id, sub, zynq_user_id]);

        return await db.query(
            `INSERT INTO tbl_treatment_sub_treatment_user_maps (treatment_id, sub_treatment_id, zynq_user_id) VALUES ?`,
            [values]
        );
    } catch (error) {
        console.error("addTreatmentSubTreatmentModel error:", error);
        throw error;
    }
};

export const addSubTreatmentsModel = async (treatment_id, sub_treatments) => {
    try {
        return await db.query(
            `INSERT INTO tbl_sub_treatments_map (parent_treatment_id, child_treatment_id) VALUES ?`,
            [sub_treatments.map(sub_treatment => [treatment_id, sub_treatment])]
        );
    } catch (error) {
        console.error("addSubTreatmentsModel error:", error);
        throw error;
    }
}

export const deleteExistingSubTreatmentsModel = async (treatment_id) => {
    try {
        return await db.query(
            `DELETE FROM tbl_sub_treatments_map WHERE parent_treatment_id = ?`,
            [treatment_id]
        );
    } catch (error) {
        console.error("deleteSubTreatmentsModel error:", error);
        throw error;
    }
}

export const checkExistingTreatmentModel = async (treatment_id, zynq_user_id) => {
    try {
        return await db.query(
            `SELECT * FROM tbl_treatments WHERE treatment_id = ? AND created_by_zynq_user_id = ?`,
            [treatment_id, zynq_user_id]
        );
    } catch (error) {
        console.error("checkExistingTreatmentModel error:", error);
        throw error;
    }
}

export const deleteExistingParentTreatmentsModel = async (treatment_id) => {
    try {
        return await db.query(
            `DELETE FROM tbl_sub_treatments_map WHERE child_treatment_id = ?`,
            [treatment_id]
        );
    } catch (error) {
        console.error("deleteExistingParentTreatmentsModel error:", error);
        throw error;
    }
}

export const deleteDoctorTreatmentsModel = async (treatment_id) => {
    try {
        return await db.query(
            `DELETE FROM tbl_doctor_treatments WHERE treatment_id = ?`,
            [treatment_id]
        );
    } catch (error) {
        console.error("deleteDoctorTreatmentsModel error:", error);
        throw error;
    }
}

export const deleteClinicTreatmentsModel = async (treatment_id) => {
    try {
        return await db.query(
            `DELETE FROM tbl_clinic_treatments WHERE treatment_id = ?`,
            [treatment_id]
        );
    } catch (error) {
        console.error("deleteClinicTreatmentsModel error:", error);
        throw error;
    }
}

export const deleteTreatmentModel = async (treatment_id) => {
    try {
        return await db.query(
            `UPDATE tbl_treatments 
            SET is_deleted = 1
            WHERE treatment_id = ?`,
            [treatment_id]
        );
    } catch (error) {
        console.error("deleteTreatmentModel error:", error);
        throw error;
    }
}

export const deleteSubTreatmentModel = async (sub_treatment_id) => {
    try {
        return await db.query(
            `UPDATE tbl_sub_treatments 
            SET is_deleted = 1
            WHERE sub_treatment_id  = ?`,
            [sub_treatment_id]
        );
    } catch (error) {
        console.error("deleteSubTreatmentModel error:", error);
        throw error;
    }
}

export const deleteSubTreatmentMasterModel = async (sub_treatment_id) => {
    try {
        return await db.query(
            `UPDATE tbl_sub_treatment_master 
            SET is_deleted = 1
            WHERE sub_treatment_id  = ?`,
            [sub_treatment_id]
        );
    } catch (error) {
        console.error("deleteSubTreatmentModel error:", error);
        throw error;
    }
}

export const deleteZynqUserTreatmentsModel = async (treatment_id, zynq_user_id) => {
    try {
        return await db.query(
            `
            UPDATE tbl_treatments SET
            is_deleted = 1
            WHERE treatment_id = ? AND created_by_zynq_user_id = ?`,
            [treatment_id, zynq_user_id]
        );
    } catch (error) {
        console.error("deleteZynqUserTreatmentsModel error:", error);
        throw error;
    }
}

export const deleteZynqUserSubTreatmentsModel = async (sub_treatment_id, zynq_user_id) => {
    try {
        return await db.query(
            `
            UPDATE tbl_treatment_sub_treatment_user_maps SET
            is_deleted = 1
            WHERE sub_treatment_id LIKE ? AND created_by_zynq_user_id = ?`,
            [sub_treatment_id, zynq_user_id]
        );
    } catch (error) {
        console.error("deleteZynqUserSubTreatmentsModel error:", error);
        throw error;
    }
}

export const deleteUserSubTreatmentsModel1 = async (sub_treatment_id) => {
    try {
        return await db.query(
            `DELETE FROM tbl_treatment_sub_treatment_user_maps WHERE treatment_id = ?`,
            [sub_treatment_id]
        );
    } catch (error) {
        console.error("deleteZynqUserSubTreatmentsModel error:", error);
        throw error;
    }
}

export const updateTreatmentApprovalStatusModel = async (treatment_id, approval_status) => {
    try {
        // 🔹 Step 1: Update approval status
        await db.query(
            `UPDATE tbl_treatments 
             SET approval_status = ? 
             WHERE treatment_id = ?`,
            [approval_status, treatment_id]
        );

        // 🔹 Step 2: Fetch the treatment creator metadata
        return await db.query(
            `SELECT 
                t.created_by_zynq_user_id,
                r.role,
                d.doctor_id,
                c.clinic_id
             FROM tbl_treatments t
             LEFT JOIN tbl_zqnq_users zu ON t.created_by_zynq_user_id = zu.id
             LEFT JOIN tbl_doctors d ON d.zynq_user_id = zu.id
             LEFT JOIN tbl_clinics c ON c.zynq_user_id = zu.id
             LEFT JOIN tbl_roles r ON zu.role_id = r.id
             WHERE t.treatment_id = ?`,
            [treatment_id]
        );

    } catch (error) {
        console.error("updateTreatmentApprovalStatus error:", error);
        throw error;
    }
};

export const addUserMappedSubTreatmentsToMaster = async (treatment_id, zynq_user_id) => {
    try {
        // Insert only missing items (avoid duplicates)
        const query = `
            INSERT INTO tbl_treatment_sub_treatments (treatment_id, sub_treatment_id)
            SELECT 
                ttstum.treatment_id,
                ttstum.sub_treatment_id
            FROM tbl_treatment_sub_treatment_user_maps ttstum
            WHERE ttstum.treatment_id = ?
              AND ttstum.zynq_user_id = ?
              AND NOT EXISTS (
                    SELECT 1 
                    FROM tbl_treatment_sub_treatments tts 
                    WHERE tts.treatment_id = ttstum.treatment_id
                    AND tts.sub_treatment_id = ttstum.sub_treatment_id
              )
        `;

        return await db.query(query, [treatment_id, zynq_user_id]);

    } catch (error) {
        console.error("addUserMappedSubTreatmentsToMaster ERROR:", error);
        throw error;
    }
};

export const checkExistingConcernModel = async (concern_id, zynq_user_id) => {
    try {
        return await db.query(
            `SELECT * FROM tbl_concerns WHERE concern_id = ? AND created_by_zynq_user_id = ?`,
            [concern_id, zynq_user_id]
        );
    } catch (error) {
        console.error("checkExistingConcernModel error:", error);
        throw error;
    }
}

export const updateConcernModel = async (concern_id, data) => {
    try {
        return await db.query(
            `UPDATE tbl_concerns SET ? WHERE concern_id = ?`,
            [data, concern_id]
        );
    } catch (error) {
        console.error("updateConcernModel error:", error);
        throw error;
    }
};

export const get_concerns_count = async (search = "", isAdmin = false, user_id = null) => {
    try {
        let conditions = "is_deleted = 0";
        const params = [];

        if (!isAdmin && user_id) {
            conditions += " AND (created_by_zynq_user_id = ? OR approval_status = 'APPROVED')";
            params.push(user_id);
        } else if (!isAdmin) {
            conditions += " AND approval_status = 'APPROVED'";
        }

        if (search) {
            conditions += " AND (name LIKE ? OR swedish LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        const sql = `SELECT COUNT(*) AS count FROM tbl_concerns WHERE ${conditions};`;
        const result = await db.query(sql, params);
        return result[0]?.count || 0;
    } catch (error) {
        console.error("get_concerns_count error:", error);
        throw error;
    }
};

export const getAllConcerns = async (lang = "en", user_id = null, isAdmin = false, limit, offset, search = "", sortBy = "created_at", sortOrder = "DESC") => {
    try {
        let query = `
            SELECT *
            FROM tbl_concerns
            WHERE is_deleted = 0
        `;
        const params = [];

        if (!isAdmin && user_id) {
            query += `
                AND (
                    created_by_zynq_user_id = ?
                    OR approval_status = 'APPROVED'
                )
            `;
            params.push(user_id);
        } else if (!isAdmin) {
            query += " AND approval_status = 'APPROVED'";
        }

        if (search) {
            query += " AND (name LIKE ? OR swedish LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        const allowedSortColumns = {
            name: 'name',
            swedish: 'swedish',
            created_at: 'created_at',
            approval_status: 'approval_status'
        };
        const orderByCol = allowedSortColumns[sortBy] || 'created_at';
        const orderDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        query += ` ORDER BY ${orderByCol} ${orderDir}`;

        if (limit !== undefined && offset !== undefined) {
            query += ` LIMIT ? OFFSET ?`;
            params.push(limit, offset);
        }

        const concernData = await db.query(query, params);

        const result = concernData.map((concern) => {
            let parsedTips = {};
            try {
                parsedTips = typeof concern.tips === "string"
                    ? JSON.parse(concern.tips)
                    : concern.tips || {};
            } catch (err) {
                console.warn(`Invalid JSON in tips for concern_id: ${concern.concern_id}`);
                parsedTips = {};
            }

            // Ensure tips is an array of trimmed strings
            const tipsString = parsedTips?.[lang] || "";
            const tipsArray = typeof tipsString === "string"
                ? tipsString.split(".,").map((tip) => tip.trim()).filter(Boolean)
                : [];

            return {
                ...concern,
                tips: tipsArray,
            };
        });

        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch indications.");
    }
};

export const addConcernModel = async (data) => {
    try {
        return await db.query(
            `INSERT INTO tbl_concerns SET ?`,
            [data]
        );
    } catch (error) {
        console.error("addConcernModel error:", error);
        throw error;
    }
}

export const checkExistingTreatmentByNameModel = async (name, swedish, exclude_treatment_id = null) => {
    try {
        const params = [name, swedish];
        let query = `
            SELECT treatment_id
            FROM tbl_treatments
            WHERE is_deleted = 0
              AND (
                    LOWER(TRIM(name)) = LOWER(TRIM(?))
                    OR LOWER(TRIM(swedish)) = LOWER(TRIM(?))
              )
        `;

        if (exclude_treatment_id) {
            query += ` AND treatment_id != ?`;
            params.push(exclude_treatment_id);
        }

        query += ` LIMIT 1`;
        return await db.query(query, params);
    } catch (error) {
        console.error("checkExistingTreatmentByNameModel error:", error);
        throw error;
    }
}

export const checkExistingConcernByNameModel = async (name, swedish, exclude_concern_id = null) => {
    try {
        const params = [name, swedish];
        let query = `SELECT concern_id
             FROM tbl_concerns
             WHERE is_deleted = 0
               AND (
                    LOWER(TRIM(name)) = LOWER(TRIM(?))
                    OR LOWER(TRIM(swedish)) = LOWER(TRIM(?))
               )
            `;

        if (exclude_concern_id) {
            query += ` AND concern_id != ?`;
            params.push(exclude_concern_id);
        }

        query += ` LIMIT 1`;
        return await db.query(query, params);
    } catch (error) {
        console.error("checkExistingConcernByNameModel error:", error);
        throw error;
    }
}

export const deleteConcernModel = async (concern_id) => {
    try {
        return await db.query(
            `UPDATE tbl_concerns SET is_deleted = 1 WHERE concern_id = ?`,
            [concern_id]
        );
    } catch (error) {
        console.error("deleteConcernModel error:", error);
        throw error;
    }
}

export const deleteZynqUserConcernsModel = async (concern_id, zynq_user_id) => {
    try {
        return await db.query(
            `UPDATE tbl_concerns SET is_deleted = 1 WHERE concern_id = ? AND created_by_zynq_user_id = ?`,
            [concern_id, zynq_user_id]
        );
    } catch (error) {
        console.error("deleteZynqUserConcernsModel error:", error);
        throw error;
    }
}

export const updateConcernApprovalStatusModel = async (concern_id, approval_status) => {
    try {
        // 🔹 Step 1: Update approval status
        await db.query(
            `UPDATE tbl_concerns 
             SET approval_status = ? 
             WHERE concern_id = ?`,
            [approval_status, concern_id]
        );

        // 🔹 Step 2: Fetch the concern creator metadata
        return await db.query(
            `SELECT 
                c.created_by_zynq_user_id,
                r.role,
                d.doctor_id,
                cl.clinic_id
             FROM tbl_concerns c
             LEFT JOIN tbl_zqnq_users zu ON c.created_by_zynq_user_id = zu.id
             LEFT JOIN tbl_doctors d ON d.zynq_user_id = zu.id
             LEFT JOIN tbl_clinics cl ON cl.zynq_user_id = zu.id
             LEFT JOIN tbl_roles r ON zu.role_id = r.id
             WHERE c.concern_id = ?`,
            [concern_id]
        );

    } catch (error) {
        console.error("updateConcernApprovalStatusModel error:", error);
        throw error;
    }
};

export const getZynqUserLanguageModel = async (zynq_user_id) => {
    try {
        return await db.query(
            `SELECT role_id ,language FROM tbl_zqnq_users WHERE id = ?`,
            [zynq_user_id]
        );
    } catch (error) {
        console.error("getZynqUserLanguage error:", error);
        throw error;
    }
};

export const getUserLanguageModel = async (user_id) => {
    try {
        return await db.query(
            `SELECT language FROM tbl_users WHERE user_id = ?`,
            [user_id]
        );
    } catch (error) {
        console.error("getUserLanguageModel error:", error);
        throw error;
    }
};

export const getTreatmentByIdModel = async (treatment_id) => {
    const rows = await db.query(
        `SELECT * FROM tbl_treatments WHERE treatment_id = ?`,
        [treatment_id]
    );
    return rows[0];
};


export const getTreatmentSubTreatmentsModel = async (treatment_id) => {
    const rows = await db.query(
        `SELECT sub_treatment_id FROM tbl_treatment_sub_treatments WHERE treatment_id = ?`,
        [treatment_id]
    );
    return rows.map(r => r.sub_treatment_id);
};

export const getDoctorInvitaionListModel = async () => {
    try {

        let conditions = `
            u.role_id IN (
                '407595e3-3196-11f0-9e07-0e8e5d906eef',  -- Solo Doctor
                '3677a3e6-3196-11f0-9e07-0e8e5d906eef'   -- Doctor
            )
                AND dcm.is_invitation_accepted = 0
        `;

        const sql = `
            SELECT 
                d.zynq_user_id,
                d.doctor_id, 
                d.name,
                d.last_name,
                d.phone, 
                u.email,
                CASE 
                    WHEN u.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef' THEN 'Solo Doctor'
                    WHEN u.role_id = '3677a3e6-3196-11f0-9e07-0e8e5d906eef' THEN 'Doctor'
                END AS user_type
            FROM tbl_doctors d
            LEFT JOIN tbl_zqnq_users u 
                ON u.id = d.zynq_user_id
            LEFT JOIN tbl_doctor_clinic_map dcm 
                ON dcm.doctor_id = d.doctor_id
            WHERE ${conditions}

            GROUP BY d.doctor_id
            ORDER BY d.created_at DESC;
        `;

        return await db.query(sql);

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor management data.");
    }
};

export const checkDoctorIdsInvitaionListModel = async (ids) => {
    try {

        let conditions = `
            u.role_id IN (
                '407595e3-3196-11f0-9e07-0e8e5d906eef',  -- Solo Doctor
                '3677a3e6-3196-11f0-9e07-0e8e5d906eef'   -- Doctor
            )
                AND dcm.is_invitation_accepted = 0 
                AND u.id IN (?)
        `;
        let params = [ids];

        const sql = `
            SELECT 
                d.zynq_user_id,
                d.doctor_id, 
                d.name,
                d.last_name,
                d.phone, 
                u.email,
                d.address,
                u.show_password,
                MAX(dcm.map_id) AS map_id,
                MAX(dcm.clinic_id) AS clinic_id,
                CASE 
                    WHEN u.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef' THEN 'Solo Doctor'
                    WHEN u.role_id = '3677a3e6-3196-11f0-9e07-0e8e5d906eef' THEN 'Doctor'
                END AS user_type
            FROM tbl_doctors d
            LEFT JOIN tbl_zqnq_users u 
                ON u.id = d.zynq_user_id
            LEFT JOIN tbl_doctor_clinic_map dcm 
                ON dcm.doctor_id = d.doctor_id
            WHERE ${conditions}

            GROUP BY d.doctor_id
            ORDER BY d.created_at DESC;
        `;

        return await db.query(sql, params);

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get doctor management data.");
    }
};

export const get_clinic_invitation_count = async ({ search = "", status = "", type = "" }) => {
    try {
        const params = [];
        let conditions = `
            c.is_deleted = 0
            AND zu.role_id IN (
                '2fc0b43c-3196-11f0-9e07-0e8e5d906eef',
                '407595e3-3196-11f0-9e07-0e8e5d906eef'
            )
        `;

        if (status) {
            conditions += " AND c.profile_status = ?";
            params.push(status);
        } else {
            conditions += " AND c.profile_status IN ('IMPORTED', 'INVITED')";
        }

        if (type) {
            if (type === "Clinic") {
                conditions += " AND zu.role_id = '2fc0b43c-3196-11f0-9e07-0e8e5d906eef'";
            } else if (type === "Solo Doctor") {
                conditions += " AND zu.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef'";
            }
        }

        if (search) {
            conditions += " AND (c.clinic_name LIKE ? OR c.email LIKE ? OR c.mobile_number LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        const sql = `
            SELECT COUNT(*) AS count
            FROM tbl_clinics c
            LEFT JOIN tbl_zqnq_users zu ON zu.id = c.zynq_user_id
            WHERE ${conditions};
        `;
        const result = await db.query(sql, params);
        return result[0]?.count || 0;
    } catch (error) {
        console.error("get_clinic_invitation_count error:", error);
        throw error;
    }
};

export const getClinicInvitaionListModel = async ({ limit, offset, search = "", status = "", type = "", sortBy = "created_at", sortOrder = "DESC" } = {}) => {
    try {
        const params = [];
        let conditions = `
            c.is_deleted = 0
            AND zu.role_id IN (
                '2fc0b43c-3196-11f0-9e07-0e8e5d906eef',
                '407595e3-3196-11f0-9e07-0e8e5d906eef'
            )
        `;

        if (status) {
            conditions += " AND c.profile_status = ?";
            params.push(status);
        } else {
            conditions += " AND c.profile_status IN ('IMPORTED', 'INVITED')";
        }

        if (type) {
            if (type === "Clinic") {
                conditions += " AND zu.role_id = '2fc0b43c-3196-11f0-9e07-0e8e5d906eef'";
            } else if (type === "Solo Doctor") {
                conditions += " AND zu.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef'";
            }
        }

        if (search) {
            conditions += " AND (c.clinic_name LIKE ? OR c.email LIKE ? OR c.mobile_number LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        const allowedSortColumns = {
            clinic_name: 'c.clinic_name',
            email: 'c.email',
            mobile_number: 'c.mobile_number',
            created_at: 'c.created_at',
            profile_status: 'c.profile_status'
        };
        const orderByCol = allowedSortColumns[sortBy] || 'c.created_at';
        const orderDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        let query = `
            SELECT 
                c.zynq_user_id,
                c.clinic_id, 
                c.clinic_name,
                c.email, 
                c.mobile_number, 
                c.address, 
                c.profile_status,
                CASE 
                    WHEN zu.role_id = '2fc0b43c-3196-11f0-9e07-0e8e5d906eef' THEN 'Clinic'
                    WHEN zu.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef' THEN 'Solo Doctor'
                END AS user_type
            FROM tbl_clinics c
            LEFT JOIN tbl_zqnq_users zu ON zu.id = c.zynq_user_id
            WHERE ${conditions}
            ORDER BY ${orderByCol} ${orderDir}
        `;

        if (limit !== undefined && limit !== null && offset !== undefined && offset !== null) {
            query += ` LIMIT ? OFFSET ?`;
            params.push(limit, offset);
        }

        return await db.query(query, params);

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get clinic invitation list.");
    }
};

export const updateLikeWiseTermsModel = async (like_wise_term_id, data) => {
    try {
        return await db.query(
            `UPDATE tbl_likewise_terms SET ? WHERE like_wise_term_id  = ?`,
            [data, like_wise_term_id]
        );
    } catch (error) {
        console.error("updateConcernModel error:", error);
        throw error;
    }
};

export const addLikeWiseTermsModel = async (data) => {
    try {
        return await db.query(
            `INSERT INTO tbl_likewise_terms SET ?`,
            [data]
        );
    } catch (error) {
        console.error("addLikeWiseTermsModel error:", error);
        throw error;
    }
};

export const checkExistingSubTreatmentByNameModel = async (treatment_id, name, swedish, exclude_sub_treatment_id = null) => {
    try {
        const params = [treatment_id, name, swedish];
        let query = `
            SELECT sub_treatment_id
            FROM tbl_sub_treatments
            WHERE is_deleted = 0
              AND treatment_id = ?
              AND (
                    LOWER(TRIM(name)) = LOWER(TRIM(?))
                    OR LOWER(TRIM(swedish)) = LOWER(TRIM(?))
              )
        `;

        if (exclude_sub_treatment_id) {
            query += ` AND sub_treatment_id != ?`;
            params.push(exclude_sub_treatment_id);
        }

        query += ` LIMIT 1`;
        return await db.query(query, params);
    } catch (error) {
        console.error("checkExistingSubTreatmentByNameModel error:", error);
        throw error;
    }
};

export const checkExistingSubTreatmentMasterByNameModel = async (name, swedish, exclude_sub_treatment_id = null) => {
    try {
        const params = [name, swedish];
        let query = `
            SELECT sub_treatment_id
            FROM tbl_sub_treatment_master
            WHERE is_deleted = 0
              AND (
                    LOWER(TRIM(name)) = LOWER(TRIM(?))
                    OR LOWER(TRIM(swedish)) = LOWER(TRIM(?))
              )
        `;

        if (exclude_sub_treatment_id) {
            query += ` AND sub_treatment_id != ?`;
            params.push(exclude_sub_treatment_id);
        }

        query += ` LIMIT 1`;
        return await db.query(query, params);
    } catch (error) {
        console.error("checkExistingSubTreatmentMasterByNameModel error:", error);
        throw error;
    }
};

export const checkExistingLikeWiseTermsByNameModel = async (name, swedish, exclude_like_wise_term_id = null) => {
    try {
        const params = [name, swedish];
        let query = `SELECT like_wise_term_id
             FROM tbl_likewise_terms
             WHERE is_deleted = 0
               AND (
                    LOWER(TRIM(name)) = LOWER(TRIM(?))
                    OR LOWER(TRIM(swedish)) = LOWER(TRIM(?))
               )
            `;

        if (exclude_like_wise_term_id) {
            query += ` AND like_wise_term_id != ?`;
            params.push(exclude_like_wise_term_id);
        }

        query += ` LIMIT 1`;
        return await db.query(query, params);
    } catch (error) {
        console.error("checkExistingLikeWiseTermsByNameModel error:", error);
        throw error;
    }
};

export const checkExistingLikeWiseTermsModel = async (like_wise_term_id, zynq_user_id) => {
    try {
        return await db.query(
            `SELECT * FROM tbl_likewise_terms WHERE like_wise_term_id  = ? AND created_by_zynq_user_id = ?`,
            [like_wise_term_id, zynq_user_id]
        );
    } catch (error) {
        console.error("checkExistingConcernModel error:", error);
        throw error;
    }
};


export const deleteLikeWiseTermsModel = async (like_wise_term_id) => {
    try {
        return await db.query(
            `UPDATE tbl_likewise_terms SET is_deleted = 1 WHERE like_wise_term_id = ?`,
            [like_wise_term_id]
        );
    } catch (error) {
        console.error("deleteLikeWiseTermsModel error:", error);
        throw error;
    }
}

export const deleteZynqUserLikeWiseTermsModel = async (like_wise_term_id, zynq_user_id) => {
    try {
        return await db.query(
            `UPDATE tbl_likewise_terms SET is_deleted = 1 WHERE like_wise_term_id = ? AND created_by_zynq_user_id = ?`,
            [like_wise_term_id, zynq_user_id]
        );
    } catch (error) {
        console.error("deleteZynqUserLikeWiseTermsModel error:", error);
        throw error;
    }
};

export const updateLikeWiseTermsApprovalStatusModel = async (like_wise_term_id, approval_status) => {
    try {
        // 🔹 Step 1: Update approval status
        await db.query(
            `UPDATE tbl_likewise_terms 
             SET approval_status = ? 
             WHERE like_wise_term_id = ?`,
            [approval_status, like_wise_term_id]
        );

        // 🔹 Step 2: Fetch the concern creator metadata
        return await db.query(
            `SELECT 
                c.created_by_zynq_user_id,
                r.role,
                d.doctor_id,
                cl.clinic_id
             FROM tbl_likewise_terms c
             LEFT JOIN tbl_zqnq_users zu ON c.created_by_zynq_user_id = zu.id
             LEFT JOIN tbl_doctors d ON d.zynq_user_id = zu.id
             LEFT JOIN tbl_clinics cl ON cl.zynq_user_id = zu.id
             LEFT JOIN tbl_roles r ON zu.role_id = r.id
             WHERE c.like_wise_term_id = ?`,
            [like_wise_term_id]
        );

    } catch (error) {
        console.error("updateConcernApprovalStatusModel error:", error);
        throw error;
    }
};



export const updateBenifitsModel = async (benefit_id, data) => {
    try {
        return await db.query(
            `UPDATE tbl_benefits SET ? WHERE benefit_id   = ?`,
            [data, benefit_id]
        );
    } catch (error) {
        console.error("updateConcernModel error:", error);
        throw error;
    }
};

export const addBenifitsModel = async (data) => {
    try {
        return await db.query(
            `INSERT INTO tbl_benefits SET ?`,
            [data]
        );
    } catch (error) {
        console.error("addBenifitsModel error:", error);
        throw error;
    }
};

export const checkExistingBenifitsModel = async (benefit_id, zynq_user_id) => {
    try {
        return await db.query(
            `SELECT * FROM tbl_benefits WHERE benefit_id   = ? AND created_by_zynq_user_id = ?`,
            [benefit_id, zynq_user_id]
        );
    } catch (error) {
        console.error("checkExistingConcernModel error:", error);
        throw error;
    }
};

export const checkExistingBenefitByNameModel = async (name, swedish, exclude_benefit_id = null) => {
    try {
        const params = [name, swedish];
        let query = `SELECT benefit_id
             FROM tbl_benefits
             WHERE is_deleted = 0
               AND (
                    LOWER(TRIM(name)) = LOWER(TRIM(?))
                    OR LOWER(TRIM(swedish)) = LOWER(TRIM(?))
               )
            `;

        if (exclude_benefit_id) {
            query += ` AND benefit_id != ?`;
            params.push(exclude_benefit_id);
        }

        query += ` LIMIT 1`;
        return await db.query(query, params);
    } catch (error) {
        console.error("checkExistingBenefitByNameModel error:", error);
        throw error;
    }
};

// 🔹 Delete (Admin)
export const deleteBenefitModel = async (benefit_id) => {
    try {
        return await db.query(
            `UPDATE tbl_benefits SET is_deleted = 1 WHERE benefit_id = ?`,
            [benefit_id]
        );
    } catch (error) {
        console.error("deleteBenefitModel error:", error);
        throw error;
    }
};

// 🔹 Delete (Zynq User – Own Record)
export const deleteZynqUserBenefitModel = async (benefit_id, zynq_user_id) => {
    try {
        return await db.query(
            `UPDATE tbl_benefits 
             SET is_deleted = 1 
             WHERE benefit_id = ? AND created_by_zynq_user_id = ?`,
            [benefit_id, zynq_user_id]
        );
    } catch (error) {
        console.error("deleteZynqUserBenefitModel error:", error);
        throw error;
    }
};

// 🔹 Update Approval Status
export const updateBenefitApprovalStatusModel = async (benefit_id, approval_status) => {
    try {
        // Step 1: Update approval status
        await db.query(
            `UPDATE tbl_benefits 
             SET approval_status = ? 
             WHERE benefit_id = ?`,
            [approval_status, benefit_id]
        );

        // Step 2: Fetch creator metadata
        return await db.query(
            `SELECT 
                b.created_by_zynq_user_id,
                r.role,
                doc.doctor_id,
                cl.clinic_id
             FROM tbl_benefits b
             LEFT JOIN tbl_zqnq_users zu ON b.created_by_zynq_user_id = zu.id
             LEFT JOIN tbl_doctors doc ON doc.zynq_user_id = zu.id
             LEFT JOIN tbl_clinics cl ON cl.zynq_user_id = zu.id
             LEFT JOIN tbl_roles r ON zu.role_id = r.id
             WHERE b.benefit_id = ?`,
            [benefit_id]
        );
    } catch (error) {
        console.error("updateBenefitApprovalStatusModel error:", error);
        throw error;
    }
};



export const getBeforeDevices = async () => {
    try {
        return await db.query(
            `SELECT t.treatment_id,t.is_admin_created,t.approval_status,t.created_by_zynq_user_id,tdum.device_name FROM tbl_treatments t JOIN tbl_treatment_devices tdum ON t.treatment_id = tdum.treatment_id WHERE t.is_deleted = 0;`
        );
    } catch (error) {
        console.error("getBeforeLikeWiseTerms error:", error);
        throw error;
    }
};

export const getBeforeLikeWiseTerms = async () => {
    try {
        return await db.query(
            `select
  tbl_treatments.treatment_id ,
  tbl_treatments.approval_status,
  tbl_treatments.is_admin_created,
  tbl_treatments.created_by_zynq_user_id,
  SUBSTRING_INDEX(SUBSTRING_INDEX(tbl_treatments.like_wise_terms, ',', numbers.n), ',', -1) like_wise_terms
from
  numbers inner join tbl_treatments
  on CHAR_LENGTH(tbl_treatments.like_wise_terms)
     -CHAR_LENGTH(REPLACE(tbl_treatments.like_wise_terms, ',', ''))>=numbers.n-1
order by
  treatment_id, n`
        );
    } catch (error) {
        console.error("getBeforeLikeWiseTerms error:", error);
        throw error;
    }
}

export const getBeforeBenefitsTerms = async () => {
    try {
        return await db.query(
            `select
  tbl_treatments.treatment_id ,
  tbl_treatments.approval_status,
  tbl_treatments.is_admin_created,
  tbl_treatments.created_by_zynq_user_id,
  SUBSTRING_INDEX(SUBSTRING_INDEX(tbl_treatments.benefits_en, ',', numbers.n), ',', -1) benefits_en
from
  numbers inner join tbl_treatments
  on CHAR_LENGTH(tbl_treatments.benefits_en )
     -CHAR_LENGTH(REPLACE(tbl_treatments.benefits_en, ',', ''))>=numbers.n-1
order by
  treatment_id, n`
        );
    } catch (error) {
        console.error("getBeforeLikeWiseTerms error:", error);
        throw error;
    }
};












export const updateDeviceModel = async (device_id, data) => {
    try {
        return await db.query(
            `UPDATE tbl_devices SET ? WHERE device_id    = ?`,
            [data, device_id]
        );
    } catch (error) {
        console.error("updateConcernModel error:", error);
        throw error;
    }
};

export const addDeviceModel = async (data) => {
    try {
        return await db.query(
            `INSERT INTO tbl_devices SET ?`,
            [data]
        );
    } catch (error) {
        console.error("addBenifitsModel error:", error);
        throw error;
    }
};

export const checkExistingDeviceModel = async (device_id, zynq_user_id) => {
    try {
        return await db.query(
            `SELECT * FROM tbl_devices WHERE device_id    = ? AND created_by_zynq_user_id = ?`,
            [device_id, zynq_user_id]
        );
    } catch (error) {
        console.error("checkExistingConcernModel error:", error);
        throw error;
    }
};

export const checkExistingDeviceByNameModel = async (name, swedish, exclude_device_id = null) => {
    try {
        const params = [name, swedish];
        let query = `SELECT device_id
             FROM tbl_devices
             WHERE is_deleted = 0
               AND (
                    LOWER(TRIM(name)) = LOWER(TRIM(?))
                    OR LOWER(TRIM(swedish)) = LOWER(TRIM(?))
               )
            `;

        if (exclude_device_id) {
            query += ` AND device_id != ?`;
            params.push(exclude_device_id);
        }

        query += ` LIMIT 1`;
        return await db.query(query, params);
    } catch (error) {
        console.error("checkExistingDeviceByNameModel error:", error);
        throw error;
    }
};



// 🔹 Delete (Admin)
export const deleteDeviceModel = async (device_id) => {
    try {
        return await db.query(
            `UPDATE tbl_devices SET is_deleted = 1 WHERE device_id = ?`,
            [device_id]
        );
    } catch (error) {
        console.error("deleteDeviceModel error:", error);
        throw error;
    }
};

// 🔹 Delete (Zynq User – Own Record)
export const deleteZynqUserDeviceModel = async (device_id, zynq_user_id) => {
    try {
        return await db.query(
            `UPDATE tbl_devices 
             SET is_deleted = 1 
             WHERE device_id = ? AND created_by_zynq_user_id = ?`,
            [device_id, zynq_user_id]
        );
    } catch (error) {
        console.error("deleteZynqUserDeviceModel error:", error);
        throw error;
    }
};

// 🔹 Update Approval Status
export const updateDeviceApprovalStatusModel = async (
    device_id,
    approval_status
) => {
    try {
        // Step 1: Update approval status
        await db.query(
            `UPDATE tbl_devices 
             SET approval_status = ? 
             WHERE device_id = ?`,
            [approval_status, device_id]
        );

        // Step 2: Fetch creator metadata
        return await db.query(
            `SELECT 
                d.created_by_zynq_user_id,
                r.role,
                doc.doctor_id,
                cl.clinic_id
             FROM tbl_devices d
             LEFT JOIN tbl_zqnq_users zu ON d.created_by_zynq_user_id = zu.id
             LEFT JOIN tbl_doctors doc ON doc.zynq_user_id = zu.id
             LEFT JOIN tbl_clinics cl ON cl.zynq_user_id = zu.id
             LEFT JOIN tbl_roles r ON zu.role_id = r.id
             WHERE d.device_id = ?`,
            [device_id]
        );
    } catch (error) {
        console.error("updateDeviceApprovalStatusModel error:", error);
        throw error;
    }
};

export const get_likewise_terms_count = async (search = "", isAdmin = false, user_id = null) => {
    try {
        let conditions = "is_deleted = 0";
        const params = [];

        if (!isAdmin && user_id) {
            conditions += " AND (created_by_zynq_user_id = ? OR approval_status = 'APPROVED')";
            params.push(user_id);
        }

        if (search) {
            conditions += " AND (name LIKE ? OR swedish LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        const sql = `SELECT COUNT(*) AS count FROM tbl_likewise_terms WHERE ${conditions};`;
        const result = await db.query(sql, params);
        return result[0]?.count || 0;
    } catch (error) {
        console.error("get_likewise_terms_count error:", error);
        throw error;
    }
};

export const getAllLikeWiseTermsModel = async (user_id = null, isAdmin = false, limit, offset, search = "", sortBy = "created_at", sortOrder = "DESC") => {
    try {
        let query = `
            SELECT *
            FROM tbl_likewise_terms
            WHERE is_deleted = 0
        `;
        const params = [];

        if (!isAdmin && user_id) {
            query += `
                AND (
                    created_by_zynq_user_id = ?
                    OR approval_status = 'APPROVED'
                )
            `;
            params.push(user_id);
        }

        if (search) {
            query += " AND (name LIKE ? OR swedish LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        const allowedSortColumns = {
            name: 'name',
            swedish: 'swedish',
            created_at: 'created_at',
            approval_status: 'approval_status'
        };
        const orderByCol = allowedSortColumns[sortBy] || 'created_at';
        const orderDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        query += ` ORDER BY ${orderByCol} ${orderDir}`;

        if (limit !== undefined && offset !== undefined) {
            query += ` LIMIT ? OFFSET ?`;
            params.push(limit, offset);
        }

        return await db.query(query, params);
    } catch (error) {
        console.error("getAllLikeWiseTermsModel error:", error);
        throw error;
    }
};


export const get_devices_count = async (search = "", isAdmin = false, user_id = null) => {
    try {
        let conditions = "is_deleted = 0";
        const params = [];

        if (!isAdmin && user_id) {
            conditions += " AND (created_by_zynq_user_id = ? OR approval_status = 'APPROVED')";
            params.push(user_id);
        }

        if (search) {
            conditions += " AND (name LIKE ? OR swedish LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        const sql = `SELECT COUNT(*) AS count FROM tbl_devices WHERE ${conditions};`;
        const result = await db.query(sql, params);
        return result[0]?.count || 0;
    } catch (error) {
        console.error("get_devices_count error:", error);
        throw error;
    }
};

export const getAllDevicesModel = async (user_id = null, isAdmin = false, limit, offset, search = "", sortBy = "created_at", sortOrder = "DESC") => {
    try {
        let query = `
            SELECT *
            FROM tbl_devices
            WHERE is_deleted = 0
        `;
        const params = [];

        if (!isAdmin && user_id) {
            query += `
                AND (
                    created_by_zynq_user_id = ?
                    OR approval_status = 'APPROVED'
                )
            `;
            params.push(user_id);
        }

        if (search) {
            query += " AND (name LIKE ? OR swedish LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        const allowedSortColumns = {
            name: 'name',
            swedish: 'swedish',
            created_at: 'created_at',
            approval_status: 'approval_status'
        };
        const orderByCol = allowedSortColumns[sortBy] || 'created_at';
        const orderDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        query += ` ORDER BY ${orderByCol} ${orderDir}`;

        if (limit !== undefined && offset !== undefined) {
            query += ` LIMIT ? OFFSET ?`;
            params.push(limit, offset);
        }

        return await db.query(query, params);
    } catch (error) {
        console.error("getAllDevicesModel error:", error);
        throw error;
    }
};

export const get_benefits_count = async (search = "", isAdmin = false, user_id = null) => {
    try {
        let conditions = "is_deleted = 0";
        const params = [];

        if (!isAdmin && user_id) {
            conditions += " AND (created_by_zynq_user_id = ? OR approval_status = 'APPROVED')";
            params.push(user_id);
        }

        if (search) {
            conditions += " AND (name LIKE ? OR swedish LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        const sql = `SELECT COUNT(*) AS count FROM tbl_benefits WHERE ${conditions};`;
        const result = await db.query(sql, params);
        return result[0]?.count || 0;
    } catch (error) {
        console.error("get_benefits_count error:", error);
        throw error;
    }
};

export const getAllBenefitsModel = async (user_id = null, isAdmin = false, limit, offset, search = "", sortBy = "created_at", sortOrder = "DESC") => {
    try {
        let query = `
            SELECT *
            FROM tbl_benefits
            WHERE is_deleted = 0
        `;
        const params = [];

        if (!isAdmin && user_id) {
            query += `
                AND (
                    created_by_zynq_user_id = ?
                    OR approval_status = 'APPROVED'
                )
            `;
            params.push(user_id);
        }

        if (search) {
            query += " AND (name LIKE ? OR swedish LIKE ?)";
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        const allowedSortColumns = {
            name: 'name',
            swedish: 'swedish',
            created_at: 'created_at',
            approval_status: 'approval_status'
        };
        const orderByCol = allowedSortColumns[sortBy] || 'created_at';
        const orderDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        query += ` ORDER BY ${orderByCol} ${orderDir}`;

        if (limit !== undefined && offset !== undefined) {
            query += ` LIMIT ? OFFSET ?`;
            params.push(limit, offset);
        }

        return await db.query(query, params);
    } catch (error) {
        console.error("getAllBenefitsModel error:", error);
        throw error;
    }
};

export const getLikeWiseTermsByIdsModel = async (
    like_wise_term_ids = []
) => {
    if (!Array.isArray(like_wise_term_ids) || like_wise_term_ids.length === 0) {
        return [];
    }

    try {
        const query = `
            SELECT *
            FROM tbl_likewise_terms
            WHERE is_deleted = 0
              AND like_wise_term_id IN (?)
            ORDER BY created_at DESC
        `;

        return await db.query(query, [like_wise_term_ids]);
    } catch (error) {
        console.error("getLikeWiseTermsByIdsModel error:", error);
        throw error;
    }
};


export const getDevicesByIdsModel = async (
    device_ids = []
) => {
    if (!Array.isArray(device_ids) || device_ids.length === 0) {
        return [];
    }

    try {
        const query = `
            SELECT *
            FROM tbl_devices
            WHERE is_deleted = 0
              AND device_id IN (?)
            ORDER BY created_at DESC
        `;

        return await db.query(query, [device_ids]);
    } catch (error) {
        console.error("getDevicesByIdsModel error:", error);
        throw error;
    }
};

export const getBenefitsByIdsModel = async (
    benefit_ids = []
) => {
    if (!Array.isArray(benefit_ids) || benefit_ids.length === 0) {
        return [];
    }

    try {
        const query = `
            SELECT *
            FROM tbl_benefits
            WHERE is_deleted = 0
              AND benefit_id IN (?)
            ORDER BY created_at DESC
        `;

        return await db.query(query, [benefit_ids]);
    } catch (error) {
        console.error("getBenefitsByIdsModel error:", error);
        throw error;
    }
};

export const getConcernsByIdsModel = async (
    concern_ids = []
) => {
    if (!Array.isArray(concern_ids) || concern_ids.length === 0) {
        return [];
    }

    try {
        const query = `
            SELECT *
            FROM tbl_concerns
            WHERE is_deleted = 0
              AND concern_id IN (?)
            ORDER BY created_at DESC
        `;

        return await db.query(query, [concern_ids]);
    } catch (error) {
        console.error("getConcernsByIdsModel error:", error);
        throw error;
    }
};


export const deleteLikeWiseTermTreatmentModel = async (treatment_id) => {
    try {
        const query = `
            DELETE FROM tbl_treatment_like_wise_terms
            WHERE treatment_id = ?
        `;
        return await db.query(query, [treatment_id]);
    } catch (error) {
        console.error("deleteLikeWiseTermTreatmentModel error:", error);
        throw error;
    }
};

export const deleteTreatmentDevicesModel = async (treatment_id) => {
    try {
        const query = `
            DELETE FROM tbl_treatment_devices
            WHERE treatment_id = ?
        `;
        return await db.query(query, [treatment_id]);
    } catch (error) {
        console.error("deleteTreatmentDevicesModel error:", error);
        throw error;
    }
};

export const deleteTreatmentConcernsModel = async (treatment_id) => {
    try {
        const query = `
            DELETE FROM tbl_treatment_concerns
            WHERE treatment_id = ?
        `;
        return await db.query(query, [treatment_id]);
    } catch (error) {
        console.error("deleteTreatmentConcernsModel error:", error);
        throw error;
    }
};

export const deleteTreatmentBenefitsModel = async (treatment_id) => {
    try {
        const query = `
            DELETE FROM tbl_treatment_benefits
            WHERE treatment_id = ?
        `;
        return await db.query(query, [treatment_id]);
    } catch (error) {
        console.error("deleteTreatmentBenefitsModel error:", error);
        throw error;
    }
};

export const insertTreatmentBenefitsModel = async (
    treatment_id,
    benefits = []
) => {
    if (!treatment_id || !Array.isArray(benefits) || benefits.length === 0) {
        return [];
    }

    try {
        const values = benefits.map(item => [
            treatment_id,
            item.benefit_id
        ]);

        const query = `
            INSERT INTO tbl_treatment_benefits
                (treatment_id, benefit_id)
            VALUES ?
        `;

        return await db.query(query, [values]);
    } catch (error) {
        console.error("insertTreatmentBenefitsModel error:", error);
        throw error;
    }
};


export const insertTreatmentDevicesModel = async (
    treatment_id,
    devices = []
) => {
    if (!treatment_id || !Array.isArray(devices) || devices.length === 0) {
        return [];
    }

    try {
        const values = devices.map(item => [
            treatment_id,
            item.device_id,
            item.name
        ]);

        const query = `
            INSERT INTO tbl_treatment_devices
                (treatment_id, device_id,device_name)
            VALUES ?
        `;

        return await db.query(query, [values]);
    } catch (error) {
        console.error("insertTreatmentDevicesModel error:", error);
        throw error;
    }
};


export const insertTreatmentConcernsModel = async (
    treatment_id,
    concerns = []
) => {
    if (!treatment_id || !Array.isArray(concerns) || concerns.length === 0) {
        return [];
    }

    try {
        const values = concerns.map(item => [
            treatment_id,
            item.concern_id
        ]);

        const query = `
            INSERT INTO tbl_treatment_concerns
                (treatment_id, concern_id)
            VALUES ?
        `;

        return await db.query(query, [values]);
    } catch (error) {
        console.error("insertTreatmentConcernsModel error:", error);
        throw error;
    }
};


export const insertTreatmentLikeWiseTermsModel = async (
    treatment_id,
    like_wise_terms = []
) => {
    if (!treatment_id || !Array.isArray(like_wise_terms) || like_wise_terms.length === 0) {
        return [];
    }

    try {
        const values = like_wise_terms.map(item => [
            treatment_id,
            item.like_wise_term_id
        ]);

        const query = `
            INSERT INTO tbl_treatment_like_wise_terms
                (treatment_id, like_wise_term_id)
            VALUES ?
        `;

        return await db.query(query, [values]);
    } catch (error) {
        console.error("insertTreatmentLikeWiseTermsModel error:", error);
        throw error;
    }
};


export const getTreatmentBenefitsModel = async (treatment_id) => {
    if (!treatment_id) return [];

    try {
        const query = `
            SELECT benefit_id
            FROM tbl_treatment_benefits
            WHERE treatment_id = ?
        `;
        return await db.query(query, [treatment_id]);
    } catch (error) {
        console.error("getTreatmentBenefitsModel error:", error);
        throw error;
    }
};

export const getTreatmentDevicesModel = async (treatment_id) => {
    if (!treatment_id) return [];

    try {
        const query = `
            SELECT device_id
            FROM tbl_treatment_devices
            WHERE treatment_id = ?
        `;
        return await db.query(query, [treatment_id]);
    } catch (error) {
        console.error("getTreatmentDevicesModel error:", error);
        throw error;
    }
};

export const getTreatmentConcernsModel = async (treatment_id) => {
    if (!treatment_id) return [];

    try {
        const query = `
            SELECT concern_id
            FROM tbl_treatment_concerns
            WHERE treatment_id = ?
        `;
        return await db.query(query, [treatment_id]);
    } catch (error) {
        console.error("getTreatmentConcernsModel error:", error);
        throw error;
    }
};

export const getTreatmentLikeWiseTermsModel = async (treatment_id) => {
    if (!treatment_id) return [];

    try {
        const query = `
            SELECT like_wise_term_id
            FROM tbl_treatment_like_wise_terms
            WHERE treatment_id = ?
        `;
        return await db.query(query, [treatment_id]);
    } catch (error) {
        console.error("getTreatmentLikeWiseTermsModel error:", error);
        throw error;
    }
};

export const getTreatmentSearchTagsOnlyModel = async (treatment_id) => {
    if (!treatment_id) return null;

    try {
        const query = `
            SELECT primary_tags, concerns, benefits, synonyms
            FROM entity_search_tags
            WHERE entity_id = ? AND entity_type = 'treatment'
        `;
        const rows = await db.query(query, [treatment_id]);
        return rows[0];
    } catch (error) {
        console.error("getTreatmentSearchTagsOnlyModel error:", error);
        throw error;
    }
};

export const getAllTreatmentSearchTagsModel = async () => {
    try {
        const query = `
            SELECT entity_id, primary_tags, concerns, benefits, synonyms
            FROM entity_search_tags
            WHERE entity_type = 'treatment'
        `;
        return await db.query(query);
    } catch (error) {
        console.error("getAllTreatmentSearchTagsModel error:", error);
        throw error;
    }
};

export const checkTagsExistForTreatmentModel = async (treatment_id) => {
    try {
        const query = `SELECT id FROM entity_search_tags WHERE entity_id = ? AND entity_type = 'treatment'`;
        const rows = await db.query(query, [treatment_id]);
        return rows.length > 0;
    } catch (error) {
        console.error("checkTagsExistForTreatmentModel error:", error);
        throw error;
    }
};

export const addTreatmentTagsModel = async (data) => {
    try {
        const query = `INSERT INTO entity_search_tags SET ?`;
        return await db.query(query, [data]);
    } catch (error) {
        console.error("addTreatmentTagsModel error:", error);
        throw error;
    }
};

export const updateTreatmentTagsModel = async (treatment_id, data) => {
    try {
        const query = `UPDATE entity_search_tags SET ? WHERE entity_id = ? AND entity_type = 'treatment'`;
        return await db.query(query, [data, treatment_id]);
    } catch (error) {
        console.error("updateTreatmentTagsModel error:", error);
        throw error;
    }
};

export const getDeviceSearchTagsOnlyModel = async (device_id) => {
    if (!device_id) return null;

    try {
        const query = `
            SELECT primary_tags, concerns, benefits, synonyms
            FROM entity_search_tags
            WHERE entity_id = ? AND entity_type = 'device'
        `;
        const rows = await db.query(query, [device_id]);
        return rows[0];
    } catch (error) {
        console.error("getDeviceSearchTagsOnlyModel error:", error);
        throw error;
    }
};

export const getAllDeviceSearchTagsModel = async () => {
    try {
        const query = `
            SELECT entity_id, primary_tags, concerns, benefits, synonyms
            FROM entity_search_tags
            WHERE entity_type = 'device'
        `;
        return await db.query(query);
    } catch (error) {
        console.error("getAllDeviceSearchTagsModel error:", error);
        throw error;
    }
};

export const checkTagsExistForDeviceModel = async (device_id) => {
    try {
        const query = `SELECT id FROM entity_search_tags WHERE entity_id = ? AND entity_type = 'device'`;
        const rows = await db.query(query, [device_id]);
        return rows.length > 0;
    } catch (error) {
        console.error("checkTagsExistForDeviceModel error:", error);
        throw error;
    }
};

export const addDeviceTagsModel = async (data) => {
    try {
        const query = `INSERT INTO entity_search_tags SET ?`;
        return await db.query(query, [data]);
    } catch (error) {
        console.error("addDeviceTagsModel error:", error);
        throw error;
    }
};

export const updateDeviceTagsModel = async (device_id, data) => {
    try {
        const query = `UPDATE entity_search_tags SET ? WHERE entity_id = ? AND entity_type = 'device'`;
        return await db.query(query, [data, device_id]);
    } catch (error) {
        console.error("updateDeviceTagsModel error:", error);
        throw error;
    }
};

// ======================= Helper Functions for admin panel implementation =======================

export const checkExistingClinicByNameModel = async (clinic_name, exclude_zynq_user_id = null) => {
    try {
        const params = [clinic_name];
        let query = `
            SELECT clinic_id
            FROM tbl_clinics
            WHERE is_deleted = 0
              AND LOWER(TRIM(clinic_name)) = LOWER(TRIM(?))
        `;
        if (exclude_zynq_user_id) {
            query += " AND zynq_user_id != ?";
            params.push(exclude_zynq_user_id);
        }
        query += " LIMIT 1";
        const result = await db.query(query, params);
        return result.length > 0;
    } catch (error) {
        console.error("checkExistingClinicByNameModel error:", error);
        throw error;
    }
};

export const checkClinicDependencies = async (clinic_id) => {
    try {
        const [doctorsRow] = await db.query(
            "SELECT COUNT(*) as count FROM tbl_doctor_clinic_map WHERE clinic_id = ? AND is_unsync = 0",
            [clinic_id]
        );
        const [appointmentsRow] = await db.query(
            "SELECT COUNT(*) as count FROM tbl_appointments WHERE clinic_id = ? AND status = 'Scheduled'",
            [clinic_id]
        );
        return {
            doctors: doctorsRow?.count || 0,
            appointments: appointmentsRow?.count || 0
        };
    } catch (error) {
        console.error("checkClinicDependencies error:", error);
        throw error;
    }
};

export const checkTreatmentDependencies = async (treatment_id) => {
    try {
        const [clinicsRow] = await db.query(
            "SELECT COUNT(*) as count FROM tbl_mapped_clinic_treatments WHERE treatment_id = ?",
            [treatment_id]
        );
        const [doctorsRow] = await db.query(
            "SELECT COUNT(*) as count FROM tbl_doctor_treatments WHERE treatment_id = ?",
            [treatment_id]
        );
        return {
            clinics: clinicsRow?.count || 0,
            doctors: doctorsRow?.count || 0
        };
    } catch (error) {
        console.error("checkTreatmentDependencies error:", error);
        throw error;
    }
};

export const checkDeviceDependencies = async (device_id) => {
    try {
        const [treatmentsRow] = await db.query(
            "SELECT COUNT(*) as count FROM tbl_treatment_devices WHERE device_id = ?",
            [device_id]
        );
        return {
            treatments: treatmentsRow?.count || 0
        };
    } catch (error) {
        console.error("checkDeviceDependencies error:", error);
        throw error;
    }
};

export const checkConcernDependencies = async (concern_id) => {
    try {
        const [treatmentsRow] = await db.query(
            "SELECT COUNT(*) as count FROM tbl_treatment_concerns WHERE concern_id = ?",
            [concern_id]
        );
        return {
            treatments: treatmentsRow?.count || 0
        };
    } catch (error) {
        console.error("checkConcernDependencies error:", error);
        throw error;
    }
};

export const checkLikeWiseTermDependencies = async (like_wise_term_id) => {
    try {
        const [treatmentsRow] = await db.query(
            "SELECT COUNT(*) as count FROM tbl_treatment_like_wise_terms WHERE like_wise_term_id = ?",
            [like_wise_term_id]
        );
        return {
            treatments: treatmentsRow?.count || 0
        };
    } catch (error) {
        console.error("checkLikeWiseTermDependencies error:", error);
        throw error;
    }
};

export const checkBenefitDependencies = async (benefit_id) => {
    try {
        const [treatmentsRow] = await db.query(
            "SELECT COUNT(*) as count FROM tbl_treatment_benefits WHERE benefit_id = ?",
            [benefit_id]
        );
        return {
            treatments: treatmentsRow?.count || 0
        };
    } catch (error) {
        console.error("checkBenefitDependencies error:", error);
        throw error;
    }
};

export const checkSubTreatmentMasterDependencies = async (sub_treatment_id) => {
    try {
        const [treatmentsRow] = await db.query(
            `SELECT COUNT(*) as count 
             FROM tbl_treatment_sub_treatments ttst
             JOIN tbl_treatments t ON ttst.treatment_id = t.treatment_id
             WHERE ttst.sub_treatment_id = ? AND t.is_deleted = 0`,
            [sub_treatment_id]
        );
        return {
            treatments: treatmentsRow?.count || 0
        };
    } catch (error) {
        console.error("checkSubTreatmentMasterDependencies error:", error);
        throw error;
    }
};

// ✅ Get expert by doctor_id
export const getDoctorById = async (doctor_id) => {
    try {
        return await db.query(
            `SELECT d.doctor_id, d.first_name, d.last_name, d.is_deleted, zu.email
             FROM tbl_doctors d
             LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
             WHERE d.doctor_id = ? AND d.is_deleted = 0
             LIMIT 1`,
            [doctor_id]
        );
    } catch (error) {
        console.error("getDoctorById error:", error);
        throw error;
    }
};

// ✅ Check if expert has any active appointments (Upcoming, Rescheduled, or currently Ongoing)
export const checkDoctorActiveAppointments = async (doctor_id) => {
    try {
        const rows = await db.query(
            `SELECT appointment_id, status, start_time, end_time
             FROM tbl_appointments
             WHERE doctor_id = ?
               AND (
                    status IN ('Upcoming', 'Rescheduled')
                    OR (start_time <= NOW() AND end_time >= NOW())
               )
             LIMIT 1`,
            [doctor_id]
        );
        return rows;
    } catch (error) {
        console.error("checkDoctorActiveAppointments error:", error);
        throw error;
    }
};

// ✅ Soft delete expert (doctor) by setting is_deleted = 1
export const softDeleteDoctorById = async (doctor_id) => {
    try {
        return await db.query(
            `UPDATE tbl_doctors SET is_deleted = 1 WHERE doctor_id = ?`,
            [doctor_id]
        );
    } catch (error) {
        console.error("softDeleteDoctorById error:", error);
        throw error;
    }
};
