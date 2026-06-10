import db from "../config/db.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatImagePath } from "../utils/user_helper.js";
import { applyLanguageOverwrite, getTopSimilarRows, translator } from "../utils/misc.util.js";
import { getTreatmentsAIResult } from "../utils/global_search.js";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
//======================================= Auth =========================================

export const get_clinic_by_zynq_user_id = async (zynq_user_id) => {
    try {
        return await db.query(`
            SELECT 
                tc.clinic_id,
                tc.zynq_user_id,
                tc.clinic_name,
                tc.profile_status,
                tc.invited_date,
                tc.invitation_email_count,
                tc.org_number,
                tc.email,
                tc.mobile_number,
                tc.address,
                tc.is_invited,
                tc.is_active,
                tc.is_deleted,
                tc.onboarding_token,
                tc.profile_completion_percentage,
                tc.created_at,
                tc.updated_at,
                tc.email_sent_at,
                tc.email_sent_count,
                tc.fee_range,
                tc.website_url,
                tc.clinic_description,
                tc.clinic_logo,
                tc.language,
                tc.form_stage,
                tc.ivo_registration_number,
                tc.hsa_id,
                tc.is_onboarded,
                tc.is_unsubscribed,
                tcl.city,
                tcl.state,
                tc.same_for_all,
                tc.slot_time
            FROM tbl_clinics tc
            LEFT JOIN tbl_clinic_locations tcl ON tc.clinic_id = tcl.clinic_id
            WHERE zynq_user_id = ?`, [zynq_user_id]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic data.");
    }
};

export const get_zqnq_user_by_email = async (email) => {
    try {
        return await db.query(`SELECT * FROM tbl_zqnq_users WHERE email = ?`, [email]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch user data.");
    }
};

export const get_clinic_by_email = async (email) => {
    try {
        return await db.query(`SELECT * FROM tbl_clinics WHERE email = ?`, [email]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic data.");
    }
};

export const get_clinic_by_mobile_number = async (mobile_number) => {
    try {
        return await db.query(`SELECT * FROM tbl_clinics WHERE mobile_number = ?`, [mobile_number]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic data.");
    }
};

export const get_clinic_by_id = async (clinic_id) => {
    try {
        return await db.query(`SELECT * FROM tbl_clinics WHERE clinic_id = ?`, [clinic_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic data.");
    }
};

export const update_clinic = async (clinicData, clinic_id) => {
    try {
        return await db.query('UPDATE tbl_clinics SET ? WHERE clinic_id = ?', [clinicData, clinic_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic data.");
    }
};

export const update_clinic_location = async (locationData, clinic_id) => {
    try {
        const [existingLocation] = await db.query('SELECT * FROM tbl_clinic_locations WHERE clinic_id = ?', [clinic_id]);
        if (existingLocation) {
            return await db.query('UPDATE tbl_clinic_locations SET ? WHERE clinic_id = ?', [locationData, clinic_id]);
        } else {
            return await db.query('INSERT INTO tbl_clinic_locations SET ?', { ...locationData, clinic_id });
        }
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic location.");
    }
};

export const update_clinic_timing = async (timing, clinic_id) => {
    try {
        // First delete existing timing
        await db.query('DELETE FROM tbl_clinic_operation_hours WHERE clinic_id = ?', [clinic_id]);

        // Then insert new timing
        const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const timingPromises = daysOfWeek.map(day => {
            if (timing[day] && timing[day].open && timing[day].close) {
                return db.query(
                    'INSERT INTO tbl_clinic_operation_hours (clinic_id, day_of_week, open_time, close_time) VALUES (?, ?, ?, ?)',
                    [clinic_id, day, timing[day].open, timing[day].close]
                );
            }
            return null;
        }).filter(promise => promise !== null);

        return await Promise.all(timingPromises);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic timing.");
    }
};

export const insertClinicData = async (clinicData) => {
    try {
        const result = await db.query('INSERT INTO tbl_clinics SET ?', [clinicData]);
        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic data.");
    }
};

export const insertClinicLocation = async (locationData) => {
    try {
        const result = await db.query('INSERT INTO tbl_clinic_locations SET ?', [locationData]);
        return result.insertId;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic location.");
    }
};

export const insertClinicSurgeries = async (surgeries, clinic_id) => {
    try {
        if (!Array.isArray(surgeries)) {
            throw new Error("Surgeries must be an array");
        }

        const insertPromises = surgeries.map(surgery_id => {
            return db.query(
                'INSERT INTO tbl_clinic_surgery (clinic_id, surgery_id) VALUES (?, ?)',
                [clinic_id, surgery_id]
            );
        });

        return await Promise.all(insertPromises);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic surgeries.");
    }
};

export const insertClinicSkinConditions = async (skin_conditions, clinic_id) => {
    try {
        if (!Array.isArray(skin_conditions)) {
            throw new Error("Skin conditions must be an array");
        }

        const insertPromises = skin_conditions.map(skin_condition_id => {
            return db.query(
                'INSERT INTO tbl_clinic_skin_condition (clinic_id, skin_condition_id) VALUES (?, ?)',
                [clinic_id, skin_condition_id]
            );
        });

        return await Promise.all(insertPromises);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic skin conditions.");
    }
};

export const insertClinicAestheticDevices = async (device_ids, clinic_id) => {
    try {
        if (!Array.isArray(device_ids)) {
            throw new Error("Aesthetic device IDs must be an array");
        }

        const insertPromises = device_ids.map(aesthetic_devices_id => {
            return db.query(
                'INSERT INTO tbl_clinic_aesthetic_devices (clinic_id, aesthetic_devices_id) VALUES (?, ?)',
                [clinic_id, aesthetic_devices_id]
            );
        });

        return await Promise.all(insertPromises);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic aesthetic devices.");
    }
};


export const insertClinicOperationHours = async (timing, clinic_id) => {
    try {
        const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const timingPromises = daysOfWeek.map(day => {
            const openTime = timing[day]?.open ?? '';
            const closeTime = timing[day]?.close ?? '';
            const isClosed = timing[day]?.is_closed ?? false;
            return db.query(
                'INSERT INTO tbl_clinic_operation_hours (clinic_id, day_of_week, open_time, close_time, is_closed) VALUES (?, ?, ?, ?, ?)',
                [clinic_id, day, openTime, closeTime, isClosed ? 1 : 0]
            );
        }).filter(Boolean);

        return await Promise.all(timingPromises);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic timing.");
    }
};

export const insertClinicEquipments = async (equipments, clinic_id) => {
    try {
        const equipmentPromises = equipments.map(equipment_id => {
            return db.query(
                'INSERT INTO tbl_clinic_equipments (clinic_id, equipment_id) VALUES (?, ?)',
                [clinic_id, equipment_id]
            );
        });
        return await Promise.all(equipmentPromises);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic equipments.");
    }
};

export const insertClinicSkinTypes = async (skin_types, clinic_id) => {
    try {
        const skinTypePromises = skin_types.map(skin_type_id => {
            return db.query(
                'INSERT INTO tbl_clinic_skin_types (clinic_id, skin_type_id) VALUES (?, ?)',
                [clinic_id, skin_type_id]
            );
        });
        return await Promise.all(skinTypePromises);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic skin types.");
    }
};

export const insertClinicSeverityLevels = async (severity_levels, clinic_id) => {
    try {
        const severityLevelPromises = severity_levels.map(severity_id => {
            return db.query(
                'INSERT INTO tbl_clinic_severity_levels (clinic_id, severity_id) VALUES (?, ?)',
                [clinic_id, severity_id]
            );
        });
        return await Promise.all(severityLevelPromises);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic severity levels.");
    }
};

export const insertClinicDocuments = async (clinic_id, certification_type_id, document_type, file_url) => {
    try {
        const result = await db.query('INSERT INTO tbl_clinic_documents (clinic_id, certification_type_id, document_type, file_url) VALUES (?, ?, ?, ?)', [clinic_id, certification_type_id, document_type, file_url]);
        return result.insertId;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert clinic document.");
    }
};

export const getAllTreatments_old = async () => {
    try {
        const treatments = await db.query(`
           SELECT
                t.approval_status,
                t.classification_type,
                t.concern_en,
                t.concern_sv,
                t.created_at,
                t.created_by_zynq_user_id,
                t.description_en,
                t.description_sv,
                t.device_name,
                t.is_admin_created,
                t.is_deleted,
                t.is_device,
                t.name,
                t.source,
                t.swedish,
                t.technology,
                t.treatment_id,
                COALESCE(
                    JSON_ARRAYAGG(
                        CASE 
                            WHEN st.sub_treatment_id IS NOT NULL THEN
                                JSON_OBJECT(
                                    'sub_treatment_id', st.sub_treatment_id,
                                    'name', st.name,
                                    'swedish', st.swedish,
                                    'is_admin_created', st.is_admin_created,
                                    'created_by_zynq_user_id', st.created_by_zynq_user_id,
                                    'approval_status', st.approval_status,
                                    'is_deleted', st.is_deleted,
                                    'created_at', st.created_at
                                )
                        END
                    ),
                    JSON_ARRAY()
                ) AS sub_treatments
            FROM tbl_treatments t
            LEFT JOIN tbl_sub_treatments st
                ON t.treatment_id = st.treatment_id
                AND st.is_deleted = 0
            WHERE t.is_deleted = 0
            GROUP BY t.treatment_id
            ORDER BY t.created_at DESC
        `);

        // Remove embeddings if present
        const cleaned = treatments.map(row => {
            delete row.embeddings;

            // Clean null values inside sub_treatments
            if (Array.isArray(row.sub_treatments)) {
                row.sub_treatments = row.sub_treatments.filter(item => item !== null);
            }

            return row;
        });

        return cleaned;

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch treatments and sub-treatments.");
    }
};

export const getAllTreatments = async () => {
    try {
        const treatments = await db.query(`
           SELECT
                t.treatment_id,
                t.name,
                t.swedish,
                t.classification_type,
                t.concern_en,
                t.concern_sv,
                t.created_at,
                t.created_by_zynq_user_id,
                t.description_en,
                t.description_sv,
                t.device_name,
                t.is_admin_created,
                t.is_deleted,
                t.is_device,
                t.source,
                t.technology,
                t.approval_status,

                COALESCE(
                    JSON_ARRAYAGG(
                        CASE 
                            WHEN tstm.sub_treatment_id IS NOT NULL THEN
                                JSON_OBJECT(
                                    'id', ttst.id,
                                    'sub_treatment_id', tstm.sub_treatment_id,
                                    'name', tstm.name,
                                    'swedish', tstm.swedish,
                                    'is_admin_created', tstm.is_admin_created,
                                    'created_by_zynq_user_id', tstm.created_by,
                                    'approval_status', tstm.approval_status,
                                    'is_deleted', tstm.is_deleted,
                                    'created_at', tstm.created_at
                                )
                        END
                    ),
                    JSON_ARRAY()
                ) AS sub_treatments

            FROM tbl_treatments t

            LEFT JOIN tbl_treatment_sub_treatments ttst
                ON t.treatment_id = ttst.treatment_id

            LEFT JOIN tbl_sub_treatment_master tstm
                ON ttst.sub_treatment_id = tstm.sub_treatment_id
                AND tstm.is_deleted = 0
                AND tstm.approval_status = 'APPROVED'

            WHERE 
                t.is_deleted = 0 AND t.approval_status = 'APPROVED'

            GROUP BY t.treatment_id
            ORDER BY t.created_at DESC
        `);

        const cleaned = treatments.map(row => {
            delete row.embeddings;

            if (Array.isArray(row.sub_treatments)) {
                row.sub_treatments = row.sub_treatments.filter(item => item !== null);
            }

            return row;
        });

        return cleaned;

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch treatments and sub-treatments.");
    }
};



export const getClinicSurgeries = async (clinic_id) => {
    try {
        const surgeries = await db.query(
            `SELECT s.* FROM tbl_surgery s
             INNER JOIN tbl_clinic_surgery cs ON s.surgery_id = cs.surgery_id
             WHERE cs.clinic_id = ?
             ORDER BY s.created_at DESC`,
            [clinic_id]
        );
        return surgeries;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic surgeries.");
    }
};

export const getClinicSkinConditions = async (clinic_id) => {
    try {
        const conditions = await db.query(
            `SELECT s.* FROM tbl_skin_conditions s
             INNER JOIN tbl_clinic_skin_condition csc ON s.skin_condition_id = csc.skin_condition_id
             WHERE csc.clinic_id = ? ORDER BY s.created_at DESC`,
            [clinic_id]
        );
        return conditions;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch skin conditions.");
    }
};

export const getClinicAestheticDevices = async (clinic_id) => {
    try {
        const devices = await db.query(
            `SELECT ad.* FROM tbl_aesthetic_devices ad
             INNER JOIN tbl_clinic_aesthetic_devices cad ON ad.aesthetic_device_id  = cad.aesthetic_devices_id 
             WHERE cad.clinic_id = ?
             ORDER BY ad.created_at DESC`,
            [clinic_id]
        );
        return devices;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic aesthetic devices.");
    }
};

export const getClinicOperationHours = async (clinic_id) => {
    try {
        const operationHours = await db.query(`SELECT * FROM tbl_clinic_operation_hours WHERE clinic_id = ? ORDER BY FIELD(
        day_of_week,
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday'
      )`, [clinic_id]);
        return operationHours;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch operation hours.");
    }
};

export const getClinicEquipments = async (clinic_id) => {
    try {
        const equipments = await db.query('SELECT e.* FROM tbl_equipments e ' +
            'INNER JOIN tbl_clinic_equipments ce ON e.equipment_id = ce.equipment_id ' +
            'WHERE ce.clinic_id = ? ORDER BY e.created_at DESC', [clinic_id]);
        return equipments;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch equipments.");
    }
};

export const getClinicSkinTypes = async (clinic_id) => {
    try {
        const skinTypes = await db.query('SELECT s.* FROM tbl_skin_types s ' +
            'INNER JOIN tbl_clinic_skin_types cst ON s.skin_type_id = cst.skin_type_id ' +
            'WHERE cst.clinic_id = ? ORDER BY s.created_at DESC', [clinic_id]);
        return skinTypes;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch skin types.");
    }
};

export const getClinicSeverityLevels = async (clinic_id) => {
    try {
        const severityLevels = await db.query('SELECT sl.* FROM tbl_severity_levels sl ' +
            'INNER JOIN tbl_clinic_severity_levels csl ON sl.severity_level_id = csl.severity_id ' +
            'WHERE csl.clinic_id = ? ORDER BY sl.created_at DESC', [clinic_id]);
        return severityLevels;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch severity levels.");
    }
};

export const getClinicSurgeriesLevels = async (clinic_id) => {
    try {
        const surgeries = await db.query(
            `SELECT s.* 
             FROM tbl_surgery s 
             INNER JOIN tbl_clinic_surgery cs 
             ON s.surgery_id = cs.surgery_id 
             WHERE cs.clinic_id = ? 
             ORDER BY s.created_at DESC`,
            [clinic_id]
        );
        return surgeries;
    } catch (error) {
        console.error("Database Error (Surgeries):", error.message);
        throw new Error("Failed to fetch surgeries.");
    }
};

export const getClinicAestheticDevicesLevel = async (clinic_id) => {
    try {
        const devices = await db.query(
            `SELECT DISTINCT ad.id,ad.treatment_id,ad.device_name,ad.created_at 
             FROM tbl_clinic_aesthetic_devices cad  
             INNER JOIN tbl_treatment_devices ad
             ON ad.id = cad.aesthetic_devices_id 
             WHERE cad.clinic_id = ? 
             ORDER BY ad.created_at DESC;`,
            [clinic_id]
        );
        return devices;
    } catch (error) {
        console.error("Database Error (Aesthetic Devices):", error.message);
        throw new Error("Failed to fetch aesthetic devices.");
    }
};

export const getClinicSkinConditionsLevel = async (clinic_id) => {
    try {
        const conditions = await db.query(
            `SELECT sc.* 
             FROM tbl_skin_conditions sc 
             INNER JOIN tbl_clinic_skin_condition csc 
             ON sc.skin_condition_id = csc.skin_condition_id 
             WHERE csc.clinic_id = ? 
             ORDER BY sc.created_at DESC`,
            [clinic_id]
        );
        return conditions;
    } catch (error) {
        console.error("Database Error (Skin Conditions):", error.message);
        throw new Error("Failed to fetch skin conditions.");
    }
};

export const getClinicDocumentsLevel = async (clinic_id) => {
    try {
        const documents = await db.query('SELECT * FROM tbl_clinic_documents WHERE clinic_id = ? ORDER BY created_at DESC', [clinic_id]);
        return documents;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch documents.");
    }
};

// getClinicDocumentsLevel

export const getClinicLocation = async (clinic_id) => {
    try {
        const location = await db.query('SELECT * FROM tbl_clinic_locations WHERE clinic_id = ? ORDER BY created_at DESC', [clinic_id]);
        return location;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch location.");
    }
};

export const getClinicProfile = async (clinic_id) => {
    try {
        const clinic = await db.query('SELECT * FROM tbl_clinics WHERE clinic_id = ? ORDER BY created_at DESC', [clinic_id]);
        return clinic;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic profile.");
    }
};

export const getAllClinicEquipments = async () => {
    try {
        const equipments = await db.query('SELECT * FROM tbl_equipments ORDER BY created_at DESC');
        return equipments;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch equipments.");
    }
};

export const getAllRoles = async () => {
    try {
        const roles = await db.query('SELECT * FROM tbl_roles');
        return roles;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch roles.");
    }
};

export const getAllSkinTypes = async (language) => {
    try {
        const skinTypes = await db.query('SELECT * FROM tbl_skin_types WHERE name IS NOT NULL ORDER BY created_at DESC');
        skinTypes?.map((item) => {
            if (language == "sv") {
                item.name = item.Swedish
            }
        })
        return skinTypes;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch skin types.");
    }
};

export const getUserSkinTypes = async (lang = 'sv') => {
    try {
        // Decide which column to use as "name"
        const nameColumn = lang === 'sv' ? 'Swedish' : 'English';

        const query = `
            SELECT 
                skin_type_id,
                ${nameColumn} AS name,
                description,
                created_at
            FROM tbl_skin_types
            WHERE ${nameColumn} IS NOT NULL
            ORDER BY created_at DESC
        `;

        const skinTypes = await db.query(query);
        return skinTypes;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch skin types.");
    }
};

export const getUserTreatments = async (lang = 'sv') => {
    try {
        // Determine which column to use for display name
        const nameColumn = lang === 'sv' ? 'swedish' : 'name';

        const query = `
            SELECT 
                treatment_id,
                ${nameColumn} AS name,
                application,
                type,
                technology,
                benefits,
                created_at
            FROM tbl_treatments
            WHERE ${nameColumn} IS NOT NULL
            ORDER BY created_at DESC
        `;

        const treatments = await db.query(query);
        return treatments;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch treatments.");
    }
};

export const getAllSeverityLevels = async () => {
    try {
        const severityLevels = await db.query('SELECT * FROM tbl_severity_levels ORDER BY created_at DESC');
        return severityLevels;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch severity levels.");
    }
};

export const getCertificateType = async () => {
    try {
        const documents = await db.query('SELECT * FROM tbl_certification_type WHERE file_name IS NOT NULL ORDER BY created_at DESC');
        return documents;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch certificate type.");
    }
};

export const updateClinicData = async (clinicData, clinic_id) => {
    try {
        const result = await db.query('UPDATE tbl_clinics SET ? WHERE clinic_id = ?', [clinicData, clinic_id]);
        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic data.");
    }
};

export const updateClinicLocation = async (locationData, clinic_id) => {
    try {
        const result = await db.query('UPDATE tbl_clinic_locations SET ? WHERE clinic_id = ?', [locationData, clinic_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic location.");
    }
};

// export const updateClinicTreatments = async (treatments, clinic_id) => {
//     try {
//         await db.query('DELETE FROM tbl_clinic_treatments WHERE clinic_id = ?', [clinic_id]);
//         if (!treatments || treatments.length === 0) return;
//         const values = treatments.map(treatment_id => [clinic_id, treatment_id]);
//         await db.query('INSERT INTO tbl_clinic_treatments (clinic_id, treatment_id) VALUES ?', [values]);
//     }
//     catch (error) {
//         console.error("Database Error:", error.message);
//         throw new Error("Failed to update clinic treatments.");
//     }
// };

export const updateClinicSurgeries = async (surgeries, clinic_id) => {
    try {
        await db.query('DELETE FROM tbl_clinic_surgery WHERE clinic_id = ?', [clinic_id]);

        if (!surgeries || surgeries.length === 0) return;

        const values = surgeries.map(surgery_id => [clinic_id, surgery_id]);
        await db.query(
            'INSERT INTO tbl_clinic_surgery (clinic_id, surgery_id) VALUES ?',
            [values]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic surgeries.");
    }
};


export const updateClinicSkinConditions = async (skin_conditions, clinic_id) => {
    try {
        await db.query('DELETE FROM tbl_clinic_skin_condition WHERE clinic_id = ?', [clinic_id]);

        if (!skin_conditions || skin_conditions.length === 0) return;

        const values = skin_conditions.map(skin_condition_id => [clinic_id, skin_condition_id]);
        await db.query(
            'INSERT INTO tbl_clinic_skin_condition (clinic_id, skin_condition_id) VALUES ?',
            [values]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic skin conditions.");
    }
};

export const updateClinicAestheticDevices = async (device_ids, clinic_id) => {
    try {
        await db.query('DELETE FROM tbl_clinic_aesthetic_devices WHERE clinic_id = ?', [clinic_id]);

        if (!device_ids || device_ids.length === 0) return;

        const values = device_ids.map(device_id => [clinic_id, device_id]);
        await db.query(
            'INSERT INTO tbl_clinic_aesthetic_devices (clinic_id, aesthetic_devices_id) VALUES ?',
            [values]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic aesthetic devices.");
    }
};



export const updateClinicOperationHours = async (clinic_timing, clinic_id) => {
    try {
        if (!clinic_timing) {
            return;
        }
        await db.query('DELETE FROM tbl_clinic_operation_hours WHERE clinic_id = ?', [clinic_id]);
        const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const timingPromises = daysOfWeek.map(day => {
            const openTime = clinic_timing[day]?.open ?? '';
            const closeTime = clinic_timing[day]?.close ?? '';
            const isClosed = clinic_timing[day]?.is_closed ?? false;

            return db.query(
                'INSERT INTO tbl_clinic_operation_hours (clinic_id, day_of_week, open_time, close_time, is_closed) VALUES (?, ?, ?, ?, ?)',
                [clinic_id, day, openTime, closeTime, isClosed ? 1 : 0]
            );
        }
        ).filter(Boolean);
        return await Promise.all(timingPromises);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic operation hours.");
    }
};

export const updateClinicEquipments = async (equipments, clinic_id) => {
    try {
        await db.query('DELETE FROM tbl_clinic_equipments WHERE clinic_id = ?', [clinic_id]);
        if (!equipments || equipments.length === 0) return;
        const values = equipments.map(equipment_id => [clinic_id, equipment_id]);
        await db.query('INSERT INTO tbl_clinic_equipments (clinic_id, equipment_id) VALUES ?', [values]);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic equipments.");
    }
};

export const updateClinicSkinTypes = async (skin_types, clinic_id) => {
    try {
        await db.query('DELETE FROM tbl_clinic_skin_types WHERE clinic_id = ?', [clinic_id]);
        if (!skin_types || skin_types.length === 0) return;
        const values = skin_types.map(skin_type_id => [clinic_id, skin_type_id]);
        await db.query('INSERT INTO tbl_clinic_skin_types (clinic_id, skin_type_id) VALUES ?', [values]);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic skin types.");
    }
};

export const updateClinicSeverityLevels = async (severity_levels, clinic_id) => {
    try {
        await db.query('DELETE FROM tbl_clinic_severity_levels WHERE clinic_id = ?', [clinic_id]);
        if (!severity_levels || severity_levels.length === 0) return;
        const values = severity_levels.map(severity_id => [clinic_id, severity_id]);
        await db.query('INSERT INTO tbl_clinic_severity_levels (clinic_id, severity_id) VALUES ?', [values]);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic severity levels.");
    }
};

export const updateClinicSkinConditionsLevel = async (skin_conditions, clinic_id) => {
    try {
        await db.query('DELETE FROM tbl_clinic_skin_condition WHERE clinic_id = ?', [clinic_id]);
        if (!skin_conditions || skin_conditions.length === 0) return;
        const values = skin_conditions.map(skin_condition_id => [clinic_id, skin_condition_id]);
        await db.query('INSERT INTO tbl_clinic_skin_condition (clinic_id, skin_condition_id) VALUES ?', [values]);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic skin conditions.");
    }
};

export const updateClinicSurgeriesLevel = async (surgeries, clinic_id) => {
    try {
        await db.query('DELETE FROM tbl_clinic_surgery WHERE clinic_id = ?', [clinic_id]);
        if (!surgeries || surgeries.length === 0) return;
        const values = surgeries.map(surgery_id => [clinic_id, surgery_id]);
        await db.query('INSERT INTO tbl_clinic_surgery (clinic_id, surgery_id) VALUES ?', [values]);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic surgeries.");
    }
};

export const updateClinicAestheticDevicesLevel = async (device_ids, clinic_id) => {
    try {
        await db.query('DELETE FROM tbl_clinic_aesthetic_devices WHERE clinic_id = ?', [clinic_id]);
        if (!device_ids || device_ids.length === 0) return;
        const values = device_ids.map(aesthetic_devices_id => [clinic_id, aesthetic_devices_id]);
        await db.query('INSERT INTO tbl_clinic_aesthetic_devices (clinic_id, aesthetic_devices_id) VALUES ?', [values]);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic aesthetic devices.");
    }
};




export const updateClinicDocuments = async (clinic_id, certification_type_id, document_type, file_url) => {
    try {
        const result = await db.query('UPDATE tbl_clinic_documents SET file_url = ? WHERE clinic_id = ? AND certification_type_id = ? AND document_type = ?', [file_url, clinic_id, certification_type_id, document_type]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic documents.");
    }
};

export const deleteClinicData = async (clinic_id) => {
    try {
        await db.query('DELETE FROM tbl_clinics WHERE clinic_id = ?', [clinic_id]);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to delete clinic data.");
    }
};

export const getCertificateTypeByFileName = async (file_name) => {
    try {
        const documents = await db.query('SELECT * FROM tbl_certification_type WHERE file_name = ? ORDER BY created_at DESC', [file_name]);
        return documents;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch certificate type.");
    }
};

export const get_all_doctors = async () => {
    try {
        const doctors = await db.query('SELECT * FROM tbl_doctors ORDER BY created_at DESC');
        return doctors;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctors.");
    }
};


// export const getDoctorAvailability = async (doctor_id) => {
//     try {
//         const availability = await db.query('SELECT * FROM tbl_doctor_availability WHERE doctor_id = ? ORDER BY created_at DESC', [doctor_id]);
//         return availability;
//     }
//     catch (error) {
//         console.error("Database Error:", error.message);
//         throw new Error("Failed to fetch doctor availability.");
//     }
// };

export const getDoctorCertifications = async (doctor_id) => {
    try {
        const certifications = await db.query(`
            SELECT c.*, ct.* 
            FROM tbl_doctor_certification c
            LEFT JOIN tbl_certification_type ct ON c.certification_type_id = ct.certification_type_id 
            WHERE c.doctor_id = ? ORDER BY c.created_at DESC`, [doctor_id]);
        return certifications;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor certifications.");
    }
};

export const getDoctorEducation = async (doctor_id) => {
    try {
        const education = await db.query('SELECT * FROM tbl_doctor_educations WHERE doctor_id = ? ORDER BY created_at DESC', [doctor_id]);
        return education;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor education.");
    }
};

export const getDoctorExperience = async (doctor_id) => {
    try {
        const experience = await db.query('SELECT * FROM tbl_doctor_experiences WHERE doctor_id = ? ORDER BY created_at DESC', [doctor_id]);
        return experience;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor experience.");
    }
};

export const getDoctorReviews = async (doctor_id) => {
    try {
        const reviews = await db.query('SELECT * FROM tbl_doctor_reviews WHERE doctor_id = ? ORDER BY created_at DESC', [doctor_id]);
        return reviews;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor reviews.");
    }
};

export const getDoctorSeverityLevels = async (doctor_id) => {
    try {
        const severityLevels = await db.query(`
            SELECT dsl.*, sl.* 
            FROM tbl_doctor_severity_levels dsl 
            LEFT JOIN tbl_severity_levels sl ON dsl.severity_id = sl.severity_level_id  
            WHERE dsl.doctor_id = ? 
            ORDER BY dsl.created_at DESC`,
            [doctor_id]
        );
        return severityLevels;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor severity levels.");
    }
};

export const getDoctorSkinTypes = async (doctor_id) => {
    try {
        const skinTypes = await db.query(`
            SELECT dst.*, st.* 
            FROM tbl_doctor_skin_types dst 
            LEFT JOIN tbl_skin_types st ON dst.skin_type_id = st.skin_type_id 
            WHERE dst.doctor_id = ? 
            ORDER BY dst.created_at DESC`,
            [doctor_id]
        );
        return skinTypes;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor skin types.");
    }
};


export const getDoctorTreatments = async (doctor_id) => {
    try {
//         const treatments = await db.query(`
//             SELECT dt.*,
//             t.treatment_id ,
//             t.name  ,
//             t.swedish  ,
//             t.classification_type  ,
//             t.description_en  ,
//             t.description_sv  ,
//             t.technology  ,
//             t.type  ,
//             t.source ,
//             t.application  ,
//             t.is_device ,
//             t.is_admin_created ,
//             t.created_by_zynq_user_id ,
//             t.approval_status  ,
//             t.is_deleted  ,
//             t.embeddings ,
//             t.name_embeddings ,
//             t.created_at ,

//              GROUP_CONCAT(
//         DISTINCT lwt.name
//         ORDER BY lwt.name
//         SEPARATOR ','
//     ) AS like_wise_terms,
   
//       GROUP_CONCAT(
//         DISTINCT lwt.swedish
//         ORDER BY lwt.name
//         SEPARATOR ','
//     ) AS like_wise_terms_swedish,


//     GROUP_CONCAT(
//         DISTINCT tbd.name
//         ORDER BY tbd.name
//         SEPARATOR ','
//     ) AS device_name,
   
//     GROUP_CONCAT(
//         DISTINCT tbd.swedish
//         ORDER BY tbd.name
//         SEPARATOR ','
//     ) AS device_name_swedish,

//     GROUP_CONCAT(
//         DISTINCT tb.name
//         ORDER BY tb.name
//         SEPARATOR ','
//     ) AS benefits_en,
   
//       GROUP_CONCAT(
//         DISTINCT tb.swedish
//         ORDER BY tb.name
//         SEPARATOR ','
//     ) AS benefits_sv

//             FROM tbl_doctor_treatments dt
//             LEFT JOIN tbl_treatments t ON dt.treatment_id = t.treatment_id

//             LEFT JOIN tbl_treatment_like_wise_terms tlwt
//     ON tlwt.treatment_id = t.treatment_id
//    LEFT JOIN tbl_likewise_terms lwt
//     ON lwt.like_wise_term_id = tlwt.like_wise_term_id
//    AND lwt.is_deleted = 0
//    AND lwt.approval_status = 'APPROVED'

//    LEFT JOIN tbl_treatment_devices d
//     ON d.treatment_id = t.treatment_id
//    LEFT JOIN tbl_devices tbd
//     ON tbd.device_id = d.device_id
//     AND tbd.is_deleted = 0
//    AND tbd.approval_status = 'APPROVED'

//    LEFT JOIN tbl_treatment_benefits ttb
//     ON ttb.treatment_id = t.treatment_id
//    LEFT JOIN tbl_benefits tb
//     ON tb.benefit_id = ttb.benefit_id
//     AND tb.is_deleted = 0
//    AND tb.approval_status = 'APPROVED'

//             WHERE dt.doctor_id = ?

//             GROUP BY dt.doctor_treatment_id

//             ORDER BY dt.created_at DESC;
//         `, [doctor_id]);

                const treatments = await db.query(`
           WITH dt_latest AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY treatment_id
               ORDER BY created_at DESC
           ) AS rn
    FROM tbl_doctor_treatments
    WHERE doctor_id = ?
)
SELECT
    dt.*,
    t.*,
    lw.like_wise_terms,
    lw.like_wise_terms_swedish,
    dv.device_name,
    dv.device_name_swedish,
    bf.benefits_en,
    bf.benefits_sv
FROM dt_latest dt
JOIN tbl_treatments t 
    ON dt.treatment_id = t.treatment_id
LEFT JOIN (
    SELECT
        tlwt.treatment_id,
        GROUP_CONCAT(DISTINCT lwt.name ORDER BY lwt.name) AS like_wise_terms,
        GROUP_CONCAT(DISTINCT lwt.swedish ORDER BY lwt.name) AS like_wise_terms_swedish
    FROM tbl_treatment_like_wise_terms tlwt
    JOIN tbl_likewise_terms lwt 
        ON lwt.like_wise_term_id = tlwt.like_wise_term_id
    WHERE lwt.is_deleted = 0 
      AND lwt.approval_status = 'APPROVED'
    GROUP BY tlwt.treatment_id
) lw ON lw.treatment_id = t.treatment_id

LEFT JOIN (
    SELECT
        d.treatment_id,
        GROUP_CONCAT(DISTINCT tbd.name ORDER BY tbd.name) AS device_name,
        GROUP_CONCAT(DISTINCT tbd.swedish ORDER BY tbd.name) AS device_name_swedish
    FROM tbl_treatment_devices d
    JOIN tbl_devices tbd 
        ON tbd.device_id = d.device_id
    WHERE tbd.is_deleted = 0 
      AND tbd.approval_status = 'APPROVED'
    GROUP BY d.treatment_id
) dv ON dv.treatment_id = t.treatment_id

LEFT JOIN (
    SELECT
        ttb.treatment_id,
        GROUP_CONCAT(DISTINCT tb.name ORDER BY tb.name) AS benefits_en,
        GROUP_CONCAT(DISTINCT tb.swedish ORDER BY tb.name) AS benefits_sv
    FROM tbl_treatment_benefits ttb
    JOIN tbl_benefits tb 
        ON tb.benefit_id = ttb.benefit_id
    WHERE tb.is_deleted = 0 
      AND tb.approval_status = 'APPROVED'
    GROUP BY ttb.treatment_id
) bf ON bf.treatment_id = t.treatment_id
WHERE dt.rn = 1
ORDER BY dt.created_at DESC;
        `, [doctor_id]);

        // Remove embeddings dynamically
        const cleanedTreatments = treatments.map(row => {
            const treatmentRow = { ...row };
            if ('embeddings' in treatmentRow) delete treatmentRow.embeddings;
            if ('name_embeddings' in treatmentRow) delete treatmentRow.name_embeddings;
            return treatmentRow;
        });

        return cleanedTreatments;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor treatments.");
    }
};


export const create_doctor = async (doctorData) => {
    try {
        const result = await db.query('INSERT INTO tbl_doctors SET ?', [doctorData]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to create doctor.");
    }
};

export const create_doctor_clinic_map = async (clinicMapData) => {
    try {
        const result = await db.query('INSERT INTO tbl_doctor_clinic_map SET ?', [clinicMapData]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to create doctor clinic map.");
    }
};

export const get_mapping_data_by_map_id = async (map_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_doctor_clinic_map WHERE map_id = ?', [map_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch mapping data by map id.");
    }
};

export const update_clinic_maping_data_accept_invitation = async (map_id) => {
    try {
        const result = await db.query('UPDATE tbl_doctor_clinic_map SET is_invitation_accepted = 1 WHERE map_id = ?', [map_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update clinic maping data accept invitation.");
    }
};

export const get_doctor_by_zynq_user_id = async (zynq_user_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_doctors WHERE zynq_user_id = ? ORDER BY created_at DESC', [zynq_user_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor by zynq user id.");
    }
};

export const get_doctor_clinic_map_by_both = async (doctor_id, clinic_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_doctor_clinic_map WHERE doctor_id = ? AND clinic_id = ?', [doctor_id, clinic_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor clinic map by both.");
    }
};

export const get_clinic_location_by_clinic_id = async (clinic_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_clinic_locations WHERE clinic_id = ?', [clinic_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic location by clinic id.");
    }
};

export const get_all_doctors_by_clinic_id = async (clinic_id) => {
    try {
        const query = `
            SELECT d.*, dcm.*, zu.email,zu.on_boarding_status
            FROM tbl_doctor_clinic_map dcm
            JOIN tbl_doctors d ON dcm.doctor_id = d.doctor_id
            JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
            WHERE dcm.clinic_id = ?  ORDER BY dcm.created_at DESC`;
        const result = await db.query(query, [clinic_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch all doctors by clinic id.");
    }
};

export const get_doctor_by_id = async (doctor_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_doctors WHERE doctor_id = ?', [doctor_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor by id.");
    }
};

export const delete_doctor_clinic_map = async (doctor_id) => {
    try {
        const result = await db.query('DELETE FROM tbl_doctor_clinic_map WHERE doctor_id = ?', [doctor_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to delete doctor clinic map.");
    }
};

export const get_mapping_data_by_doctor_id = async (doctor_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_doctor_clinic_map WHERE doctor_id = ?', [doctor_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch mapping data by doctor id.");
    }
};

export const update_doctor_password = async (clinic_id, password) => {
    try {
        const result = await db.query('UPDATE tbl_zqnq_users SET password = ? WHERE id = ?', [password, clinic_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update doctor password.");
    }
};

export const insertProduct = async (productData) => {
    try {
        const result = await db.query('INSERT INTO tbl_products SET ?', [productData]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to add product.");
    }
};

export const get_all_products = async (clinic_id) => {
    try {
        const result = await db.query(
            `
            SELECT
                p.*,
                IF(COUNT(t.treatment_id), JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'treatment_id', t.treatment_id,
                        'name',         t.name,
                        'swedish',      t.swedish,
                        'application',  t.application,
                        'type',         t.type,
                        'technology',   t.technology,
                        'created_at',   t.created_at
                    )
                ), JSON_ARRAY()) AS treatments
            FROM tbl_products AS p
            LEFT JOIN tbl_product_treatments AS pt ON pt.product_id = p.product_id
            LEFT JOIN tbl_treatments AS t ON t.treatment_id = pt.treatment_id
            WHERE p.clinic_id = ?
            GROUP BY p.product_id
            ORDER BY p.created_at DESC
            `,
            [clinic_id]
        );
        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch all products.");
    }
};

export const get_product_by_id = async (product_id) => {
    try {
        const result = await db.query(
            `
            SELECT
                p.*,
                IF(COUNT(t.treatment_id), JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'treatment_id', t.treatment_id,
                        'name',         t.name,
                        'swedish',      t.swedish,
                        'application',  t.application,
                        'type',         t.type,
                        'technology',   t.technology,
                        'created_at',   t.created_at
                    )
                ), JSON_ARRAY()) AS treatments
            FROM tbl_products AS p
            LEFT JOIN tbl_product_treatments AS pt ON pt.product_id = p.product_id
            LEFT JOIN tbl_treatments AS t ON t.treatment_id = pt.treatment_id
            WHERE p.product_id = ?
            GROUP BY p.product_id
            `,
            [product_id]
        );
        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch product by product id.");
    }
};

export const get_product_by_product_id = async (product_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_products WHERE product_id = ?', [product_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch product by product id.");
    }
};

export const deleteProductImageByProductId = async (product_id) => {
    try {
        const result = await db.query('DELETE FROM tbl_product_images WHERE product_id = ?', [product_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to delete product image by product id.");
    }
};

export const updateProduct = async (productData, product_id) => {
    try {
        const result = await db.query('UPDATE tbl_products SET ? WHERE product_id = ?', [productData, product_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update product.");
    }
};

export const deleteProduct = async (product_id) => {
    try {
        const result = await db.query('DELETE FROM tbl_products WHERE product_id = ?', [product_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to delete product.");
    }
};

export const insertProductImage = async (image_url) => {
    try {
        const result = await db.query('INSERT INTO tbl_product_images SET ?', [image_url]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert product image.");
    }
};

export const get_product_images = async (product_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_product_images WHERE product_id = ?', [product_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch product images.");
    }
};

export const get_product_image_by_id = async (product_image_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_product_images WHERE product_image_id = ?', [product_image_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch product image by id.");
    }
};

export const deleteProductImage = async (product_image_id) => {
    try {
        const result = await db.query('DELETE FROM tbl_product_images WHERE product_image_id = ?', [product_image_id]);
        return result;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to delete product image.");
    }
};

export const insertProductTreatments = async (treatment_ids_array, product_id) => {
    try {
        const values = treatment_ids_array.map(treatment_id => [product_id, treatment_id]);

        const result = await db.query(
            `INSERT INTO tbl_product_treatments (product_id, treatment_id) VALUES ?`,
            [values]
        );

        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert product treatments.");
    }
};

export const updateProductTreatments = async (treatment_ids_array, product_id) => {
    try {
        await db.query(
            `DELETE FROM tbl_product_treatments WHERE product_id = ?`,
            [product_id]
        );

        if (treatment_ids_array.length > 0) {
            const values = treatment_ids_array.map(treatment_id => [product_id, treatment_id]);

            const result = await db.query(
                `INSERT INTO tbl_product_treatments (product_id, treatment_id) VALUES ?`,
                [values]
            );

            return result;
        }
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update product treatments.");
    }
};

export const deleteProductTreatments = async (product_id) => {
    try {
        await db.query(
            `DELETE FROM tbl_product_treatments WHERE product_id = ?`,
            [product_id]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to delete product treatments.");
    }
};

export const get_issue_categories = async () => {
    try {
        const result = await db.query('SELECT * FROM tbl_issue_categories');
        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch issue categories.");
    }
}

export const insertSupportTicket = async (supportTicketData) => {
    try {
        const result = await db.query('INSERT INTO tbl_support_tickets SET ?', [supportTicketData]);
        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert support ticket.");
    }
}

export const get_support_tickets_by_clinic_id = async (clinic_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_support_tickets WHERE clinic_id = ? ORDER BY created_at DESC', [clinic_id]);

        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch support tickets.");
    }
}

export const get_issue_by_id = async (support_ticket_id) => {
    try {
        return await db.query(`SELECT * FROM tbl_doctor_support_tickets WHERE support_ticket_id  = ?`, [support_ticket_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic data.");
    }
};

export const get_support_tickets_by_doctor_id_to_clinic = async (clinic_id) => {
    try {
        const result = await db.query('SELECT * FROM tbl_doctor_support_tickets WHERE clinic_id = ? ORDER BY created_at DESC', [clinic_id]);

        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch support tickets.");
    }
}

export const send_ticket_response = async (clinic_response, ticket_id) => {
    try {
        return await db.query(`UPDATE  tbl_doctor_support_tickets SET clinic_response = ? , responded_at = NOW() where support_ticket_id  = ? `, [clinic_response, ticket_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to add doctor personal details.");
    }
};

export const getAllSkinCondition = async () => {
    try {
        const conditions = await db.query('SELECT * FROM tbl_skin_conditions');
        return conditions;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch conditions.");
    }
};

export const getAllsurgery = async (language) => {
    try {
        const surgeries = await db.query('SELECT * FROM tbl_surgery');
        surgeries?.map((item) => {
            if (language == "sv") {
                item.english = item.swedish
            }
        })
        return surgeries;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch surgeries.");
    }
}

export const getAllDevices = async (ids) => {
    try {
        if (!ids || !ids.length) {
            return await db.query('SELECT * FROM tbl_treatment_devices');
        }

        const sql = `SELECT * FROM tbl_treatment_devices WHERE treatment_id IN (?)`;

        // MySQL expects an array inside array → [[]]
        const devices = await db.query(sql, [ids]);

        return devices;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch devices.");
    }
};


export const getClinicTreatmentsBulkV2 = async (clinicIds, lang = 'en') => {
    try {
        const query = `
            SELECT
        c.clinic_id,
        c.clinic_name,

        COALESCE(
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'clinic_treatment_id', ct.clinic_treatment_id,
              'treatment_id', ct.treatment_id,
              'name', t.name,
              'swedish', t.swedish,
              'total_price', ct.total_price,
              'sub_treatments',
                COALESCE(
                  (
                    SELECT JSON_ARRAYAGG(
                      JSON_OBJECT(
                        'clinic_sub_treatment_id', cst.clinic_sub_treatment_id,
                        'sub_treatment_id', cst.sub_treatment_id,
                        'name', st.name,
                        'swedish', st.swedish,
                        'price', cst.price
                      )
                    )
                    FROM tbl_mapped_clinic_sub_treatments cst
                    LEFT JOIN tbl_sub_treatment_master st
                      ON cst.sub_treatment_id = st.sub_treatment_id
                      AND st.is_deleted = 0
                    WHERE cst.clinic_treatment_id = ct.clinic_treatment_id
                  ),
                  JSON_ARRAY()
                )
            )
          ),
          JSON_ARRAY()
        ) AS treatments
      FROM tbl_clinics c
      LEFT JOIN tbl_mapped_clinic_treatments ct
        ON c.clinic_id = ct.clinic_id
      LEFT JOIN tbl_treatments t
        ON ct.treatment_id = t.treatment_id
        AND t.is_deleted = 0
      WHERE c.clinic_id IN (?)
        AND c.is_deleted = 0
      GROUP BY c.clinic_id
        `;

        const results = await db.query(query, clinicIds);


        return applyLanguageOverwrite(results, lang) || [];
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic treatments.");
    }
};

export const getClinicOperationHoursBulk = async (clinicIds) => {
    const placeholders = clinicIds.map(() => '?').join(',');
    const query = `SELECT * FROM tbl_clinic_operation_hours WHERE clinic_id IN (${placeholders})ORDER BY
      FIELD(
        day_of_week,
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday'
      )`;
    const results = await db.query(query, clinicIds);

    const grouped = {};
    results.forEach(row => {
        if (!grouped[row.clinic_id]) grouped[row.clinic_id] = [];
        grouped[row.clinic_id].push(row);
    });
    return grouped;
};

export const getClinicSkinTypesBulk = async (clinicIds, lang = "en") => {
    const placeholders = clinicIds.map(() => '?').join(',');
    const query = `SELECT st.*,cst.* FROM tbl_skin_types st INNER JOIN
    tbl_clinic_skin_types cst ON st.skin_type_id = cst.skin_type_id WHERE cst.clinic_id IN (${placeholders}) ORDER BY cst.created_at DESC`;
    const results = await db.query(query, clinicIds);

    const grouped = {};
    results.forEach(row => {
        if (!grouped[row.clinic_id]) grouped[row.clinic_id] = [];
        grouped[row.clinic_id].push(row);


        // ✅ Set surgery name dynamically
        row.name = lang === "sv" ? row.Swedish : row.English;
        row.description = lang === "sv" ? row.desc_sv : row.description;

    });
    return grouped;
};

export const getClinicSkinConditionBulk = async (clinicIds) => {
    const placeholders = clinicIds.map(() => '?').join(',');
    const query = `SELECT sc.*,csc.* FROM tbl_skin_conditions sc INNER JOIN  tbl_clinic_skin_condition csc ON  sc.skin_condition_id = csc.skin_condition_id WHERE csc.clinic_id IN (${placeholders})`;
    const results = await db.query(query, clinicIds);

    const grouped = {};
    results.forEach(row => {
        if (!grouped[row.clinic_id]) grouped[row.clinic_id] = [];
        grouped[row.clinic_id].push(row);
    });
    return grouped;
};

export const getClinicSurgeryBulk = async (clinicIds, lang = "en") => {
    const placeholders = clinicIds.map(() => '?').join(',');
    const query = `SELECT s.*,cs.* FROM tbl_surgery s INNER JOIN tbl_clinic_surgery cs ON s.surgery_id  = cs.surgery_id WHERE cs.clinic_id IN (${placeholders})`;
    const results = await db.query(query, clinicIds);

    const grouped = {};
    results.forEach(row => {
        if (!grouped[row.clinic_id]) grouped[row.clinic_id] = [];
        grouped[row.clinic_id].push(row);

        // ✅ Set surgery name dynamically
        row.name = lang === "sv" ? row.swedish : row.english;
    });
    return grouped;
};

export const getClinicAstheticDevicesBulk = async (clinicIds) => {
    const placeholders = clinicIds.map(() => '?').join(',');
    const query = `SELECT ad.*, cad.* FROM tbl_aesthetic_devices ad INNER JOIN  tbl_clinic_aesthetic_devices cad ON ad.aesthetic_device_id = cad.aesthetic_devices_id    WHERE cad.clinic_id IN (${placeholders})`;
    const results = await db.query(query, clinicIds);

    const grouped = {};
    results.forEach(row => {
        if (!grouped[row.clinic_id]) grouped[row.clinic_id] = [];
        grouped[row.clinic_id].push(row);
    });
    return grouped;
};

export const getClinicLocationsBulk = async (clinicIds) => {
    const placeholders = clinicIds.map(() => '?').join(',');
    const query = `SELECT * FROM tbl_clinic_locations WHERE clinic_id IN (${placeholders})`;
    const results = await db.query(query, clinicIds);

    const grouped = {};
    results.forEach(row => {
        if (!grouped[row.clinic_id]) grouped[row.clinic_id] = [];
        grouped[row.clinic_id].push(row);
    });
    return grouped;
};

export const getClinicDoctorsBulk = async (clinicIds = []) => {
    if (!clinicIds.length) return {};

    try {

        const selectFields = [
            'd.doctor_id',
            'd.name',
            'TIMESTAMPDIFF(YEAR, MIN(de.start_date), MAX(IFNULL(de.end_date, CURDATE()))) AS experience_years',
            'd.specialization',
            `CASE 
        WHEN MAX(zu.role_id) = '407595e3-3196-11f0-9e07-0e8e5d906eef'
            THEN MAX(d.fee_per_session)
        ELSE MAX(dm.fee_per_session)
     END AS fee_per_session`,
            'd.profile_image',
            'dm.clinic_id',
            'c.clinic_name',
            'c.address AS clinic_address',
            'ROUND(AVG(ar.rating), 2) AS avg_rating',
            'GROUP_CONCAT(DISTINCT dt.treatment_id) AS treatment_ids'
        ].join(', ');

        const query = `
            SELECT ${selectFields}
            FROM tbl_doctors d
            LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
            LEFT JOIN tbl_doctor_clinic_map dm ON d.doctor_id = dm.doctor_id
            LEFT JOIN tbl_clinics c ON dm.clinic_id = c.clinic_id
            LEFT JOIN tbl_appointment_ratings ar ON d.doctor_id = ar.doctor_id AND ar.approval_status = 'APPROVED'
            LEFT JOIN tbl_doctor_experiences de ON d.doctor_id = de.doctor_id
            LEFT JOIN tbl_doctor_treatments dt ON d.doctor_id = dt.doctor_id
            WHERE dm.clinic_id IN (?)
              AND d.profile_completion_percentage >= 0 and c.is_onboarded = 1
              AND (
                 (zu.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef' AND zu.on_boarding_status >= 4)
                    OR
                  (zu.role_id = '3677a3e6-3196-11f0-9e07-0e8e5d906eef' AND zu.on_boarding_status >= 3)
                      )
                  AND d.profile_status = "VERIFIED"
            GROUP BY d.doctor_id, dm.clinic_id
            ORDER BY d.created_at DESC
        `;


        const rows = await db.query(query, [...clinicIds]);

        // 🧹 Group results by clinic_id
        const grouped = {};
        for (const row of rows) {
            row.profile_image = formatImagePath(row.profile_image, 'doctor/profile_images');

            // Parse JSON array if returned as string
            if (typeof row.treatment_ids === 'string' && row.treatment_ids.trim()) {
                row.treatment_ids = [...new Set(row.treatment_ids.split(',').map(id => id.trim()))];
            } else {
                row.treatment_ids = [];
            }

            if (!grouped[row.clinic_id]) grouped[row.clinic_id] = [];
            grouped[row.clinic_id].push(row);
        }

        return grouped;
    } catch (err) {
        console.error("Error in getClinicDoctorsBulk:", err.message);
        throw new Error("Failed to fetch doctors for clinics.");
    }
};

export const getDoctorCertificationsBulk = async (doctorIds) => {
    try {
        const placeholders = doctorIds.map(() => '?').join(',');

        const query = `SELECT c.*, ct.* 
            FROM tbl_doctor_certification c
            LEFT JOIN tbl_certification_type ct ON c.certification_type_id = ct.certification_type_id 
            WHERE c.doctor_id IN (${placeholders}) ORDER BY c.created_at DESC`;
        const results = await db.query(query, doctorIds);

        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];
            grouped[row.doctor_id].push(row);
        });
        return grouped;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor certifications.");
    }
};

export const getDoctorCertificationsBulkV2 = async (doctorIds, lang = "en") => {
    try {
        if (!doctorIds?.length) return {};

        const placeholders = doctorIds.map(() => "?").join(",");

        const query = `
            SELECT c.*, ct.* 
            FROM tbl_doctor_certification c
            LEFT JOIN tbl_certification_type ct 
                ON c.certification_type_id = ct.certification_type_id 
            WHERE c.doctor_id IN (${placeholders})
            ORDER BY c.created_at DESC
        `;

        const results = await db.query(query, doctorIds);

        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];

            const certRow = { ...row };

            // ✅ Normalize language field
            certRow.name = lang === "sv" ? row.swedish : row.name;

            grouped[row.doctor_id].push(certRow);
        });

        return grouped;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor certifications.");
    }
};

export const getDoctorEducationBulk = async (doctorIds) => {
    try {
        const placeholders = doctorIds.map(() => '?').join(',');

        const query = `SELECT * FROM tbl_doctor_educations WHERE degree IS NOT NULL AND doctor_id IN (${placeholders}) ORDER BY created_at DESC`;
        const results = await db.query(query, doctorIds);

        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];
            grouped[row.doctor_id].push(row);
        });
        return grouped;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor education.");
    }
};

export const getDoctorExperienceBulk = async (doctorIds) => {
    try {
        const placeholders = doctorIds.map(() => '?').join(',');

        const query = `SELECT * FROM tbl_doctor_experiences WHERE organization IS NOT NULL and doctor_id IN (${placeholders}) ORDER BY created_at DESC`;
        const results = await db.query(query, doctorIds);

        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];
            grouped[row.doctor_id].push(row);
        });
        return grouped;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor education.");
    }
};

export const getDoctorSkinTypesBulk = async (doctorIds) => {
    try {
        const placeholders = doctorIds.map(() => '?').join(',');

        const query = `SELECT dst.*, st.* 
            FROM tbl_doctor_skin_types dst 
            LEFT JOIN tbl_skin_types st ON dst.skin_type_id = st.skin_type_id WHERE name is not null AND dst.doctor_id IN (${placeholders}) ORDER BY dst.created_at DESC`;
        const results = await db.query(query, doctorIds);

        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];
            grouped[row.doctor_id].push(row);
        });
        return grouped;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor education.");
    }
};

export const getDoctorSkinTypesBulkV2 = async (doctorIds, lang = "en", clinic_id) => {
    try {
        if (!doctorIds?.length) return {};

        const placeholders = doctorIds.map(() => "?").join(",");

        const query = `
            SELECT dst.*, st.* 
            FROM tbl_doctor_skin_types dst 
            LEFT JOIN tbl_skin_types st 
                ON dst.skin_type_id = st.skin_type_id 
            WHERE st.English IS NOT NULL 
              AND dst.doctor_id IN (?) AND dst.clinic_id = ?
            ORDER BY dst.created_at DESC
        `;

        const results = await db.query(query, [doctorIds, clinic_id]);

        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];

            row.name = lang === "sv" ? row.Swedish : row.English;
            row.description = lang === "sv" ? row.desc_sv : row.description;

            const skinTypeRow = { ...row };

            // ✅ Normalize to `name` based on lang

            grouped[row.doctor_id].push(skinTypeRow);
        });

        return grouped;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor skin types.");
    }
};

export const getDoctorTreatmentsBulk = async (doctorIds) => {
    if (!Array.isArray(doctorIds) || doctorIds.length === 0) return {};

    try {
        const placeholders = doctorIds.map(() => '?').join(',');

        const query = `
            SELECT dt.*,
            t.treatment_id ,
            t.name  ,
            t.swedish  ,
            t.classification_type  ,
            t.description_en  ,
            t.description_sv  ,
            t.technology  ,
            t.type  ,
            t.source ,
            t.application  ,
            t.is_device ,
            t.is_admin_created ,
            t.created_by_zynq_user_id ,
            t.approval_status  ,
            t.is_deleted  ,
            t.embeddings ,
            t.name_embeddings ,
            t.created_at ,

             GROUP_CONCAT(
        DISTINCT lwt.name
        ORDER BY lwt.name
        SEPARATOR ','
    ) AS like_wise_terms,
   
      GROUP_CONCAT(
        DISTINCT lwt.swedish
        ORDER BY lwt.name
        SEPARATOR ','
    ) AS like_wise_terms_swedish,


    GROUP_CONCAT(
        DISTINCT tbd.name
        ORDER BY tbd.name
        SEPARATOR ','
    ) AS device_name,
   
    GROUP_CONCAT(
        DISTINCT tbd.swedish
        ORDER BY tbd.name
        SEPARATOR ','
    ) AS device_name_swedish,

    GROUP_CONCAT(
        DISTINCT tb.name
        ORDER BY tb.name
        SEPARATOR ','
    ) AS benefits_en,
   
      GROUP_CONCAT(
        DISTINCT tb.swedish
        ORDER BY tb.name
        SEPARATOR ','
    ) AS benefits_sv

            FROM tbl_doctor_treatments dt
            LEFT JOIN tbl_treatments t ON dt.treatment_id = t.treatment_id

            LEFT JOIN tbl_treatment_like_wise_terms tlwt
    ON tlwt.treatment_id = t.treatment_id
   LEFT JOIN tbl_likewise_terms lwt
    ON lwt.like_wise_term_id = tlwt.like_wise_term_id
   AND lwt.is_deleted = 0
   AND lwt.approval_status = 'APPROVED'

   LEFT JOIN tbl_treatment_devices d
    ON d.treatment_id = t.treatment_id
   LEFT JOIN tbl_devices tbd
    ON tbd.device_id = d.device_id
    AND tbd.is_deleted = 0
   AND tbd.approval_status = 'APPROVED'

   LEFT JOIN tbl_treatment_benefits ttb
    ON ttb.treatment_id = t.treatment_id
   LEFT JOIN tbl_benefits tb
    ON tb.benefit_id = ttb.benefit_id
    AND tb.is_deleted = 0
   AND tb.approval_status = 'APPROVED'

            WHERE dt.doctor_id IN (${placeholders})

            GROUP BY dt.doctor_treatment_id

            ORDER BY dt.created_at DESC
        `;

        const results = await db.query(query, doctorIds);

        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];

            // Remove embeddings from t.*
            const treatmentRow = { ...row };
            if ('embeddings' in treatmentRow) delete treatmentRow.embeddings;

            grouped[row.doctor_id].push(treatmentRow);
        });

        return grouped;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor treatments.");
    }
};


export const getDoctorTreatmentsBulkV3 = async (doctorId, clinic_id, lang = 'en', search = null) => {
    try {
        const query = `
            SELECT 
                dt.doctor_id,
                dt.treatment_id,
                dt.price,
                dt.sub_treatment_id,
                dt.sub_treatment_price,

                t.name,
                t.swedish,
                t.classification_type,
                t.description_en,
                t.description_sv,
                t.is_device,
                t.is_admin_created,

                    GROUP_CONCAT(
        DISTINCT tb.name
        ORDER BY tb.name
        SEPARATOR ','
    ) AS benefits_en,
   
      GROUP_CONCAT(
        DISTINCT tb.swedish
        ORDER BY tb.name
        SEPARATOR ','
    ) AS benefits_sv,

                st.name AS sub_treatment_name_en,
                st.swedish AS sub_treatment_name_sv

            FROM tbl_doctor_treatments dt
            LEFT JOIN tbl_treatments t 
                ON dt.treatment_id = t.treatment_id
            LEFT JOIN tbl_sub_treatment_master st
                ON dt.sub_treatment_id = st.sub_treatment_id

                   LEFT JOIN tbl_treatment_benefits ttb
    ON ttb.treatment_id = t.treatment_id
   LEFT JOIN tbl_benefits tb
    ON tb.benefit_id = ttb.benefit_id
    AND tb.is_deleted = 0
   AND tb.approval_status = 'APPROVED'
   

            WHERE dt.doctor_id = ?
                AND dt.clinic_id= ?
               AND  t.is_deleted = 0
                AND t.approval_status = 'APPROVED'
                
   GROUP BY dt.doctor_id,
                dt.treatment_id,
                dt.price,
                dt.sub_treatment_id,
                dt.sub_treatment_price

            ORDER BY t.name, st.name;
        `;

        // SAFE QUERY
        let results = await db.query(query, [doctorId, clinic_id]);

        // APPLY SEARCH (if needed)
        if (search) {
            var normalized_search;
            if (search.length <= 3) {
                console.log("Short query, returning default valid_medical");
                normalized_search = search
            } else {
                console.log("Long query, translating to english");
                normalized_search = await translator(search, 'en', true);
            }
            results = await getTreatmentsAIResult(results, normalized_search, 0.4, null, lang);

            // results = await getTopSimilarRows(results, search);
        }

        // TRANSLATE FIELDS
        results = results.map(row => ({
            ...row,
            treatment_name: lang === 'sv' ? row.swedish : row.name,
            sub_treatment_name: lang === 'sv' ? row.sub_treatment_name_sv : row.sub_treatment_name_en
        }));

        // GROUP DATA: treatment → sub_treatments
        const grouped = {};

        for (const row of results) {
            if (!grouped[row.treatment_id]) {
                grouped[row.treatment_id] = {
                    treatment_id: row.treatment_id,
                    name: row.treatment_name,
                    price: row.price,
                    classification_type: row.classification_type,
                    description_en: row.description_en,
                    description_sv: row.description_sv,
                    benefits_en: row.benefits_en,
                    benefits_sv: row.benefits_sv,
                    is_device: row.is_device,
                    is_admin_created: row.is_admin_created,
                    sub_treatments: []
                };
            }

            // Add sub treatment
            if (row.sub_treatment_id) {
                grouped[row.treatment_id].sub_treatments.push({
                    sub_treatment_id: row.sub_treatment_id,
                    name: row.sub_treatment_name,
                    price: row.sub_treatment_price
                });
            }
        }

        // Convert to array
        return Object.values(grouped);

    } catch (error) {
        console.error("DB Error:", error.message);
        throw new Error("Failed to fetch doctor treatments.");
    }
};


export const getDoctorSkinConditionBulk = async (doctorIds) => {
    const placeholders = doctorIds.map(() => '?').join(',');
    const query = `SELECT sc.*,dsc.* FROM tbl_skin_conditions sc INNER JOIN  tbl_doctor_skin_condition dsc ON  sc.skin_condition_id = dsc.skin_condition_id WHERE dsc.doctor_id IN (${placeholders})`;
    const results = await db.query(query, doctorIds);

    const grouped = {};
    results.forEach(row => {
        if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];
        grouped[row.doctor_id].push(row);
    });
    return grouped;
};

export const getDoctorSkinConditionBulkV2 = async (doctorIds, lang = "en") => {
    try {
        if (!doctorIds?.length) return {};

        const placeholders = doctorIds.map(() => "?").join(",");

        const query = `
            SELECT dsc.*, sc.* 
            FROM tbl_doctor_skin_condition dsc
            INNER JOIN tbl_skin_conditions sc 
                ON dsc.skin_condition_id = sc.skin_condition_id
            WHERE dsc.doctor_id IN (?) 
        `;

        const results = await db.query(query, [doctorIds]);

        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];

            const conditionRow = { ...row };

            // ✅ Set condition name dynamically
            conditionRow.name = lang === "sv" ? row.swedish : row.english;

            grouped[row.doctor_id].push(conditionRow);
        });

        return grouped;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor skin conditions.");
    }
};


export const getDoctorSurgeryBulk = async (doctorIds) => {
    const placeholders = doctorIds.map(() => '?').join(',');
    const query = `SELECT s.*,ds.* FROM tbl_surgery s INNER JOIN tbl_doctor_surgery ds ON s.surgery_id  = ds.surgery_id WHERE ds.doctor_id IN (${placeholders})`;
    const results = await db.query(query, doctorIds);

    const grouped = {};
    results.forEach(row => {
        if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];
        grouped[row.doctor_id].push(row);
    });
    return grouped;
};

export const getDoctorSurgeryBulkV2 = async (doctorIds, lang = "en", clinic_id) => {
    try {
        if (!doctorIds?.length) return {};

        const placeholders = doctorIds.map(() => "?").join(",");

        const query = `
            SELECT ds.*, s.* 
            FROM tbl_doctor_surgery ds
            INNER JOIN tbl_surgery s ON ds.surgery_id = s.surgery_id
            WHERE ds.doctor_id IN (?) AND ds.clinic_id = ?
        `;

        const results = await db.query(query, [doctorIds, clinic_id]);

        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];

            const surgeryRow = { ...row };

            // ✅ Set surgery name dynamically
            surgeryRow.name = lang === "sv" ? row.swedish : row.english;

            grouped[row.doctor_id].push(surgeryRow);
        });

        return grouped;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor surgeries.");
    }
};

export const getDoctorAstheticDevicesBulk = async (doctorIds) => {
    const placeholders = doctorIds.map(() => '?').join(',');
    const query = `SELECT ad.*, dad.* FROM tbl_aesthetic_devices ad INNER JOIN  tbl_doctor_aesthetic_devices dad ON ad.aesthetic_device_id = dad.aesthetic_devices_id    WHERE dad.doctor_id IN (${placeholders})`;
    const results = await db.query(query, doctorIds);

    const grouped = {};
    results.forEach(row => {
        if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];
        grouped[row.doctor_id].push(row);
    });
    return grouped;
};

export const getDoctorDevicesBulk = async (zynqUserId, clinicId) => {
    try {
        return await db.query(`
        SELECT 
                tdum.*, td.*
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

export const getDoctorRatings = async (doctorId) => {
    try {
        const query = `
        SELECT ar.*, u.full_name, u.profile_image
        FROM tbl_appointment_ratings ar
        LEFT JOIN tbl_users u ON ar.user_id = u.user_id
        WHERE ar.doctor_id = ? AND ar.approval_status = 'APPROVED'
        ORDER BY ar.created_at DESC`;
        const results = await db.query(query, [doctorId]);
        return results.map(row => ({
            ...row,
            profile_image: formatImagePath(row.profile_image, ''),
        }));
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor ratings.");
    }
}

export const getDoctorReviewsBulk = async (doctorIds) => {
    try {
        const placeholders = doctorIds.map(() => '?').join(',');
        const query = `SELECT * FROM tbl_doctor_reviews WHERE doctor_id IN (${placeholders}) ORDER BY created_at DESC`;
        const results = await db.query(query, doctorIds);


        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];
            grouped[row.doctor_id].push(row);
        });


        return grouped;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor reviews.");
    }
};


export const getDoctorSeverityLevelsBulk = async (doctorIds) => {
    try {
        const placeholders = doctorIds.map(() => '?').join(',');
        const query = `SELECT * FROM tbl_doctor_severity_levels WHERE doctor_id IN (${placeholders}) ORDER BY created_at DESC`;
        const results = await db.query(query, doctorIds);

        const grouped = {};
        results.forEach(row => {
            if (!grouped[row.doctor_id]) grouped[row.doctor_id] = [];
            grouped[row.doctor_id].push(row);
        });

        return grouped;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor severity levels.");
    }
};

export const getChatsBetweenUserAndDoctors = async (userId, doctorUserIds) => {
    if (!doctorUserIds.length) return [];

    return await db.query(
        `SELECT * FROM tbl_chats
         WHERE
           (userId_1 = ? AND userId_2 IN (?))
           OR
           (userId_2 = ? AND userId_1 IN (?))`,
        [userId, doctorUserIds, userId, doctorUserIds]
    );
};

export const insertClinicImages = async (clinicId, imageFilenames = []) => {
    if (!imageFilenames.length) return;

    const values = imageFilenames.map(() => `(?, ?)`).join(', ');
    const params = imageFilenames.flatMap(filename => [clinicId, filename]);

    const query = `
        INSERT INTO tbl_clinic_images (clinic_id, image_url)
        VALUES ${values}
    `;

    return await db.query(query, params);
};

export const getClinicImages = async (clinic_id) => {
    try {
        const rows = await db.query(
            `SELECT clinic_image_id, image_url FROM tbl_clinic_images WHERE clinic_id = ?`,
            [clinic_id]
        );
        return rows;
    } catch (error) {
        console.error("Error in getClinicImages:", error);
        throw error;
    }
};

export const deleteClinicImageById = async (clinic_image_id, clinic_id = null) => {
    try {
        // 1. Get image_url first
        const rows = await db.query(
            `SELECT image_url FROM tbl_clinic_images WHERE clinic_image_id = ? `,
            [clinic_image_id]
        );

        if (rows.length === 0) return null;

        const imageFileName = rows[0]?.image_url;
        const filePath = path.join(__dirname, '../uploads/clinic/files', imageFileName);

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        const result = await db.query(
            `DELETE FROM tbl_clinic_images WHERE clinic_image_id = ? `,
            [clinic_image_id]
        );

        return result;
    } catch (error) {
        console.error("Error in deleteClinicImageById:", error);
        throw error;
    }
};


export const deleteClinicImageModel = async (clinic_image_ids) => {
    try {
        const result = await db.query(
            `DELETE FROM tbl_clinic_images WHERE clinic_image_id IN (?) `,
            [clinic_image_ids]
        );
        return result;
    } catch (error) {
        console.error("Error in deleteClinicImageById:", error);
        throw error;
    }
}


export const calculateAndUpdateClinicProfileCompletion = async (clinic) => {
    try {
        let filledFieldsCount = 0;
        let totalFieldsCount = 0;

        const basicFields = [
            "clinic_name",
            // "org_number",
            "email",
            "mobile_number",
            "address",
            "fee_range",
            "website_url",
            "clinic_description",
            // "clinic_logo",
            "form_stage"
        ];

        totalFieldsCount += basicFields.length;
        basicFields.forEach(field => {
            if (clinic[field]) filledFieldsCount++;
        });

        // 2. Location
        totalFieldsCount += 1;
        if (clinic.location) filledFieldsCount++;

        // 3. Treatments
        totalFieldsCount += 1;
        if (clinic.treatments && clinic.treatments.length > 0) filledFieldsCount++;

        // 4. Operation Hours
        totalFieldsCount += 1;
        if (clinic.operation_hours && clinic.operation_hours.length > 0) filledFieldsCount++;

        // 6. Expertise categories
        const expertiseCategories = [
            "skin_types",
            "severity_levels",
            "surgeries_level",
            "aestheticDevices",
            "skin_Conditions"
        ];

        totalFieldsCount += expertiseCategories.length;
        expertiseCategories.forEach(category => {
            if (clinic[category] && clinic[category].length > 0) filledFieldsCount++;
        });

        // 7. Documents
        totalFieldsCount += 1;
        if (clinic.documents && clinic.documents.length > 0) filledFieldsCount++;

        // 8. Images
        totalFieldsCount += 1;
        if (clinic.images && clinic.images.length > 0) filledFieldsCount++;

        // Final %
        const completionPercentage =
            totalFieldsCount > 0
                ? Math.round((filledFieldsCount / totalFieldsCount) * 100)
                : 0;

        await db.query(
            `UPDATE tbl_clinics 
             SET profile_completion_percentage = ? 
             WHERE clinic_id = ?`,
            [completionPercentage, clinic.clinic_id]
        );

        return completionPercentage;

    } catch (error) {
        console.error("Error calculating/saving clinic profile completion:", error);
        return 0;
    }
};

export const calculateAndUpdateBulkClinicProfileCompletion = async (clinics) => {
    try {
        if (!clinics || clinics.length === 0) {
            return [];
        }

        const results = await Promise.all(
            clinics.map(async (clinic) => {
                let filledFieldsCount = 0;
                let totalFieldsCount = 0;
                const missingFields = [];

                // 1️⃣ Basic Fields
                const basicFields = [
                    "clinic_name",
                    "email",
                    "mobile_number",
                    "clinic_description",
                    "city",
                ];

                totalFieldsCount += basicFields.length;
                basicFields.forEach(field => {
                    if (clinic[field]) filledFieldsCount++;
                    else missingFields.push(field);
                });


                // 🧮 Final %
                const completionPercentage =
                    totalFieldsCount > 0
                        ? Math.round((filledFieldsCount / totalFieldsCount) * 100)
                        : 0;

                return {
                    clinic_id: clinic.clinic_id,
                    completionPercentage,
                    missingFields
                };
            })
        );

        // 🔹 Bulk Update Query
        if (results.length > 0) {
            const caseStatements = results
                .map(r => `WHEN '${r.clinic_id}' THEN ${r.completionPercentage}`)
                .join(" ");
            const clinicIds = results.map(r => `'${r.clinic_id}'`).join(", ");

            const updateQuery = `
                UPDATE tbl_clinics
                SET profile_completion_percentage = CASE clinic_id
                    ${caseStatements}
                END
                WHERE clinic_id IN (${clinicIds})
            `;

            await db.query(updateQuery);
        }

        return results;
    } catch (error) {
        console.error("❌ Error calculating bulk clinic profile completion:", error);
        throw error;
    }
};

export const getProductByProductAndClinicId = async (product_id, clinic_id) => {
    try {
        return await db.query(
            `SELECT * FROM tbl_products WHERE product_id = ? AND clinic_id = ?`,
            [product_id, clinic_id]
        );
    } catch (error) {
        console.error("getProductByProductAndClinicId error:", error);
        throw error;
    }
}

export async function createClinicMappedTreatments(clinicId, treatments = []) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        for (const treatment of treatments) {
            const clinicTreatmentId = uuidv4();

            /** Insert clinic treatment */
            await connection.query(
                `
        INSERT INTO tbl_mapped_clinic_treatments
        (clinic_treatment_id, clinic_id, treatment_id, total_price)
        VALUES (?, ?, ?, ?)
        `,
                [
                    clinicTreatmentId,
                    clinicId,
                    treatment.treatment_id,
                    treatment.total_price,
                ]
            );

            /** Insert sub-treatments (BULK INSERT) */
            if (treatment.sub_treatments?.length) {
                const subValues = treatment.sub_treatments.map((sub) => [
                    uuidv4(),
                    clinicTreatmentId,
                    sub.sub_treatment_id,
                    sub.price,
                ]);

                await connection.query(
                    `
          INSERT INTO tbl_mapped_clinic_sub_treatments
          (clinic_sub_treatment_id, clinic_treatment_id, sub_treatment_id, price)
          VALUES ?
          `,
                    [subValues]
                );
            }
        }

        await connection.commit();
        return { success: true };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};


export async function updateClinicMappedTreatments(clinicId, treatments = []) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        /** Get existing clinic treatment IDs */
        const existing = await connection.query(
            `
      SELECT clinic_treatment_id
      FROM tbl_mapped_clinic_treatments
      WHERE clinic_id = ?
      `,
            [clinicId]
        );

        const ids = existing[0].map((r) => r.clinic_treatment_id);

        /** Delete sub-treatments first */
        if (ids.length) {
            await connection.query(
                `
        DELETE FROM tbl_mapped_clinic_sub_treatments
        WHERE clinic_treatment_id IN (?)
        `,
                [ids]
            );
        }

        /** Delete treatments */
        await connection.query(
            `
      DELETE FROM tbl_mapped_clinic_treatments
      WHERE clinic_id = ?
      `,
            [clinicId]
        );

        /** Re-insert */
        for (const treatment of treatments) {
            const clinicTreatmentId = uuidv4();

            await connection.query(
                `
        INSERT INTO tbl_mapped_clinic_treatments
        (clinic_treatment_id, clinic_id, treatment_id, total_price)
        VALUES (?, ?, ?, ?)
        `,
                [
                    clinicTreatmentId,
                    clinicId,
                    treatment.treatment_id,
                    treatment.total_price,
                ]
            );

            if (treatment.sub_treatments?.length) {
                const subValues = treatment.sub_treatments.map((sub) => [
                    uuidv4(),
                    clinicTreatmentId,
                    sub.sub_treatment_id,
                    sub.price,
                ]);

                await connection.query(
                    `
          INSERT INTO tbl_mapped_clinic_sub_treatments
          (clinic_sub_treatment_id, clinic_treatment_id, sub_treatment_id, price)
          VALUES ?
          `,
                    [subValues]
                );
            }
        }

        await connection.commit();
        return { success: true };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}


export async function getClinicMappedTreatments(clinicId) {
    try {
        const rows = await db.query(
            `
      SELECT
        c.clinic_id,
        c.clinic_name,

        COALESCE(
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'clinic_treatment_id', ct.clinic_treatment_id,
              'treatment_id', ct.treatment_id,
              'name', t.name,
              'swedish', t.swedish,
              'total_price', ct.total_price,
              'sub_treatments',
                COALESCE(
                  (
                    SELECT JSON_ARRAYAGG(
                      JSON_OBJECT(
                        'clinic_sub_treatment_id', cst.clinic_sub_treatment_id,
                        'sub_treatment_id', cst.sub_treatment_id,
                        'name', st.name,
                        'swedish', st.swedish,
                        'price', cst.price
                      )
                    )
                    FROM tbl_mapped_clinic_sub_treatments cst
                    LEFT JOIN tbl_sub_treatment_master st
                      ON cst.sub_treatment_id = st.sub_treatment_id
                      AND st.is_deleted = 0
                    WHERE cst.clinic_treatment_id = ct.clinic_treatment_id
                  ),
                  JSON_ARRAY()
                )
            )
          ),
          JSON_ARRAY()
        ) AS treatments

      FROM tbl_clinics c

      LEFT JOIN tbl_mapped_clinic_treatments ct
        ON c.clinic_id = ct.clinic_id

      LEFT JOIN tbl_treatments t
        ON ct.treatment_id = t.treatment_id
        AND t.is_deleted = 0

      WHERE c.clinic_id = ?
        AND c.is_deleted = 0

      GROUP BY c.clinic_id
      `,
            [clinicId]
        );

        if (!rows.length) return null;

        return rows[0];
    } catch (error) {
        console.error("Error fetching clinic mapped treatments:", error.message);
        throw error; // let controller handle response
    }
}


export const getAllSurgeriesOfClinic = async (language, clinic_id) => {
    try {
        const sql = `
            SELECT s.*
            FROM tbl_clinic_surgery cs
            INNER JOIN tbl_surgery s
                ON cs.surgery_id = s.surgery_id 
            WHERE cs.clinic_id = ?
        `;

        const surgeries = await db.query(sql, [clinic_id]);

        surgeries?.forEach(item => {
            if (language === "sv") {
                item.english = item.swedish;
            }
        });

        return surgeries;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch surgeries.");
    }
};


export const getAllDevicesOfClinic = async (clinic_id, ids = []) => {
    try {
        let sql = `
            SELECT DISTINCT d.id ,d.treatment_id,d.device_name,d.created_at
            FROM tbl_clinic_aesthetic_devices cad
            INNER JOIN tbl_treatment_devices d
                ON cad.aesthetic_devices_id = d.id
            WHERE cad.clinic_id = ?
        `;
        let params = [clinic_id];

        if (Array.isArray(ids) && ids.length > 0) {
            sql += ` AND d.treatment_id IN (?)`;
            params.push(ids);
        }

        return await db.query(sql, params);

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic devices.");
    }
};


export const getAllSkinTypesOfClinic = async (language, clinic_id) => {
    try {
        const sql = `
            SELECT st.*
            FROM tbl_clinic_skin_types csc
            INNER JOIN tbl_skin_types st
                ON csc.skin_type_id  = st.skin_type_id  
            WHERE csc.clinic_id = ?
            ORDER BY st.created_at DESC
        `;

        const skinTypes = await db.query(sql, [clinic_id]);

        skinTypes?.forEach(item => {
            if (language === "sv") {
                item.name = item.Swedish;
            }
        });

        return skinTypes;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch skin types.");
    }
};


export const unsynkClinicModel = async (doctor_id, clinic_id) => {
    try {
        const sql = `
            UPDATE tbl_doctor_clinic_map
            SET is_unsync = 1
            WHERE doctor_id = ? AND clinic_id = ?
        `;
        const result = await db.query(sql, [doctor_id, clinic_id]);
        return result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to unsink clinic.");
    }
};

export const getDoctorClinicMappedDataModel = async (doctor_id, clinic_id) => {
    try {
        return await db.query(`
            SELECT
                cl.*,
                c.*,
                u.email
            FROM
                tbl_doctor_clinic_map dcm
            JOIN
                tbl_clinics c ON dcm.clinic_id = c.clinic_id
            LEFT JOIN
                tbl_clinic_locations cl ON cl.clinic_id = c.clinic_id
            LEFT JOIN
                tbl_zqnq_users u ON c.zynq_user_id = u.id
            WHERE
                dcm.doctor_id = ? AND dcm.clinic_id = ? AND dcm.is_unsync = 0
            ORDER BY
                dcm.assigned_at DESC;
        `, [doctor_id, clinic_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic data by doctor ID.");
    }
};