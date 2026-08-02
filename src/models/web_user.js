import db from "../config/db.js";
import { extractUserData } from "../utils/misc.util.js";

//======================================= Auth =========================================

export const get_web_user_by_id = async (id) => {

    try {
        return await db.query(`SELECT
            u.*, 
            r.role AS role_name
        FROM
            tbl_zqnq_users u
        JOIN
            tbl_roles r ON u.role_id = r.id
        WHERE
            u.id = ?`, [id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch web user data.");
    }
};

export const get_web_user_by_email = async (email) => {
    try {
        return await db.query(`SELECT
            u.*, 
            r.role AS role_name
        FROM
            tbl_zqnq_users u
        JOIN
            tbl_roles r ON u.role_id = r.id
        WHERE
            u.email = ?`, [email]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic data.");
    }
};

export const update_reset_token = async (reset_token, reset_token_expiry, email, language) => {
    try {
        return await db.query(`UPDATE tbl_zqnq_users SET reset_token = ?, reset_token_expiry = ?,language = ? WHERE email = ?`, [reset_token, reset_token_expiry, language, email]);
    } catch (error) {
        console.error("Database Error:", error.message);

    }
}

export const get_web_user_by_reset_token = async (reset_token) => {
    try {
        return await db.query(`SELECT * FROM tbl_zqnq_users WHERE reset_token = ?`, [reset_token]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch web user data.");
    }
}

export const update_jwt_fcm_token = async (token, fcm_token, id, language) => {
    try {
        let query = `UPDATE tbl_zqnq_users SET jwt_token = ?, language = ? `;
        const params = [token, language];

        // Only update fcm_token if provided (not null or undefined)
        if (fcm_token != null) {
            query += `, fcm_token = ?`;
            params.push(fcm_token);
        }

        query += ` WHERE id = ?`;
        params.push(id);

        const result = await db.query(query, params);

        // Sync language to tbl_clinics if they have clinic profile
        await db.query(`UPDATE tbl_clinics SET language = ? WHERE zynq_user_id = ?`, [language, id]);

        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update JWT and/or FCM token.");
    }
};

export const update_web_user_password = async (password, show_password, reset_token, reset_token_expiry, id) => {
    try {
        return await db.query(`UPDATE tbl_zqnq_users SET password = ?, show_password = ?, reset_token = ?, reset_token_expiry = ? WHERE id = ?`, [password, show_password, reset_token, reset_token_expiry, id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update web user password.");
    }
}

export const update_onboarding_status = async (status, id) => {
    try {
        return await db.query(`UPDATE tbl_zqnq_users SET on_boarding_status = ? WHERE id = ?`, [status, id]);
    } catch (error) {
        console.error("Database Error:", error.message);

    }
};

export const update_web_user_password_set = async (password, show_password, id, language) => {
    try {
        return await db.query(`UPDATE tbl_zqnq_users SET password = ?, show_password = ?, is_password_set = 1,language = ? WHERE id = ?`, [password, show_password, language, id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update web user password.");
    }
}

export const create_web_user = async (userData) => {
    try {
        return await db.query('INSERT INTO tbl_zqnq_users SET ?', [userData]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to create web user.");
    }
}


export const getCallLogById = async (call_id) => {
    const [rows] = await db.query(
        `SELECT * FROM tbl_call_logs WHERE call_id = ?`,
        [call_id]
    );
    return rows;
};

export const updateCallLogStatus = async (call_id, status) => {
    return await db.query(
        `UPDATE tbl_call_logs SET status = ?, created_at = NOW() WHERE call_id = ?`,
        [status, call_id]
    );
};

export const createOrUpdateCallLog = async ({
    call_id,
    sender_user_id,
    sender_doctor_id,
    receiver_user_id,
    receiver_doctor_id,
    status,
    started_at
}) => {
    try {
        await db.query(`
      INSERT INTO tbl_call_logs (
        call_id, sender_user_id, sender_doctor_id,
        receiver_user_id, receiver_doctor_id, status, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        started_at = VALUES(started_at)
    `, [
            call_id,
            sender_user_id,
            sender_doctor_id,
            receiver_user_id,
            receiver_doctor_id,
            status,
            started_at
        ]);
    } catch (error) {
        console.error("Error in createOrUpdateCallLog:", error);
        throw error;
    }
};



export const getAllCallLogs = async () => {
    const [rows] = await db.query(`
    SELECT 
      call_id,
      caller_id,
      sender_user_id,
      sender_doctor_id,
      receiver_user_id,
      receiver_doctor_id,
      status,
      started_at
    FROM tbl_call_logs
    ORDER BY started_at DESC
  `);

    return rows;
};

export const get_user_by_id = async (id) => {
    return await db.query(`SELECT * FROM tbl_users WHERE user_id = ?`, [id]);

};

export const getWebUserById = async (id) => {
    return await db.query(`SELECT * FROM tbl_zqnq_users WHERE id = ?`, [id]);
};

export const toggleUserLanguage = async (userData) => {
    try {
        const { role, language } = userData;
        const newLanguage = language === 'sv' ? 'en' : 'sv';

        if (role === 'USER') {
            const { user_id } = userData;

            // Update only in users table
            await db.query(
                `UPDATE tbl_users SET language = ? WHERE user_id = ?`,
                [newLanguage, user_id]
            );
        } else {
            const { id: zynq_user_id } = userData;

            // Update base zynq user table
            await db.query(
                `UPDATE tbl_zqnq_users SET language = ? WHERE id = ?`,
                [newLanguage, zynq_user_id]
            );

            const roleTableMap = {
                CLINIC: 'tbl_clinics',
                SOLO_DOCTOR: 'tbl_clinics',
                DOCTOR: 'tbl_doctors',
                SOLO_DOCTOR: 'tbl_doctors'
            };

            const targetTable = roleTableMap[role];
            if (targetTable) {
                // Update role-specific table
                await db.query(
                    `UPDATE ${targetTable} SET language = ? WHERE zynq_user_id = ?`,
                    [newLanguage, zynq_user_id]
                );
            }
        }
    } catch (error) {
        console.error("Error in toggleUserLanguage:", error.message);
        throw error;
    }
};

/**
 * Fetches full_name (or name/clinic_name) and fcm_token based on user role.
 * 
 * @param {string} userId - ID of the user (primary key per role).
 * @param {string} role - One of 'USER', 'DOCTOR', 'SOLO_DOCTOR', 'CLINIC'
 * @returns {Promise<{ full_name: string, fcm_token: string }>}
 */
export const getUserDataByRole = async (userId, role) => {
    try {
        let query = '';
        let values = [];

        switch (role) {
            case 'USER':
                query = `
                    SELECT user_id AS user_id_actual, full_name, fcm_token
                    FROM tbl_users
                    WHERE user_id = ?
                `;
                values = [userId];
                break;

            case 'DOCTOR':
            case 'SOLO_DOCTOR':
                query = `
                    SELECT d.doctor_id AS user_id_actual, d.name AS full_name, z.fcm_token
                    FROM tbl_doctors d
                    JOIN tbl_zqnq_users z ON z.id = d.zynq_user_id
                    WHERE d.zynq_user_id = ?
                `;
                values = [userId];
                break;

            case 'CLINIC':
                query = `
                    SELECT c.clinic_id AS user_id_actual, c.clinic_name AS full_name, z.fcm_token
                    FROM tbl_clinics c
                    JOIN tbl_zqnq_users z ON z.id = c.zynq_user_id
                    WHERE c.zynq_user_id = ?
                `;
                values = [userId];
                break;

            default:
                console.error(`❌ Invalid role: ${role}`);
                return null;
        }

        const userData = await db.query(query, values);
        if (!userData[0]) {
            console.error(`❌ No user found for ID ${userId} with role ${role}`);
            return null;
        }

        return {
            user_id: userData[0].user_id_actual,
            zynq_user_id: userId,
            role,
            full_name: userData[0].full_name,
            token: userData[0].fcm_token,
        };

    } catch (error) {
        console.error('❌ Error in getUserDataByRole:', error.message);
        return null;
    }
};

export const detectUserDataById = async (id) => {
    try {
        const query = `
            SELECT 
                u.user_id AS user_id, 
                'USER' AS role, 
                u.full_name, 
                u.fcm_token
            FROM tbl_users u
            WHERE u.user_id = ?

            UNION ALL

            SELECT 
                d.doctor_id AS user_id, 
                'DOCTOR' AS role, 
                d.name AS full_name, 
                z.fcm_token
            FROM tbl_doctors d
            JOIN tbl_zqnq_users z ON z.id = d.zynq_user_id
            WHERE d.zynq_user_id = ?

            UNION ALL

            SELECT 
                c.clinic_id AS user_id, 
                'CLINIC' AS role, 
                c.clinic_name AS full_name, 
                z.fcm_token
            FROM tbl_clinics c
            JOIN tbl_zqnq_users z ON z.id = c.zynq_user_id
            WHERE c.zynq_user_id = ?

            UNION ALL

            SELECT 
                a.admin_id AS user_id, 
                'ADMIN' AS role, 
                a.full_name, 
                a.fcm_token
            FROM tbl_admin a
            WHERE a.admin_id = ?

            LIMIT 1;
        `;

        const [userData] = await db.query(query, [id, id, id, id]);


        if (!userData) {
            console.warn(`🔍 No matching record found for ID: ${id}`);
            return null;
        }

        return userData;

    } catch (error) {
        console.error('❌ Error in detectUserDataById:', error.message);
        return null;
    }
};

export const getUserDataByReceiverIdAndRole = async (receiverId, role) => {
    try {
        let query = '';
        let values = [];

        switch (role) {
            case 'USER':
                query = `
                    SELECT user_id AS user_id, NULL AS zynq_user_id, 'USER' AS role, full_name, fcm_token
                    FROM tbl_users
                    WHERE user_id = ?
                `;
                values = [receiverId];
                break;

            case 'DOCTOR':
            case 'SOLO_DOCTOR': // Treat SOLO_DOCTOR same as DOCTOR
                query = `
                    SELECT d.doctor_id AS user_id, d.zynq_user_id, 'DOCTOR' AS role, d.name AS full_name, z.fcm_token
                    FROM tbl_doctors d
                    JOIN tbl_zqnq_users z ON z.id = d.zynq_user_id
                    WHERE d.doctor_id = ?
                `;
                values = [receiverId];
                break;

            case 'CLINIC':
                query = `
                    SELECT c.clinic_id AS user_id, c.zynq_user_id, 'CLINIC' AS role, c.clinic_name AS full_name, z.fcm_token
                    FROM tbl_clinics c
                    JOIN tbl_zqnq_users z ON z.id = c.zynq_user_id
                    WHERE c.clinic_id = ?
                `;
                values = [receiverId];
                break;

            case 'ADMIN':
                query = `
                    SELECT admin_id AS user_id, NULL AS zynq_user_id, 'ADMIN' AS role, full_name, fcm_token
                    FROM tbl_admin
                    WHERE admin_id = ?
                `;
                values = [receiverId];
                break;

            default:
                console.error(`❌ Unknown role: ${role}`);
                return null;
        }

        const [userData] = await db.query(query, values);

        if (!userData) {
            console.error(`❌ No user found for ID ${receiverId} with role ${role}`);
            return null;
        }

        return {
            user_id: userData.user_id,
            zynq_user_id: userData.zynq_user_id,
            role: userData.role,
            full_name: userData.full_name,
            token: userData.fcm_token,
        };

    } catch (error) {
        console.error('❌ Error in getUserDataByReceiverIdAndRole:', error.message);
        return null;
    }
};
