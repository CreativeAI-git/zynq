import db from "../config/db.js";
import { formatBenefitsUnified, getTopSimilarRows, getTreatmentIDsByUserID, paginateRows, getTopSimilarRowsWithoutTranslate, translator, applyLanguageOverwrite } from "../utils/misc.util.js";
import { isEmpty } from "../utils/user_helper.js";
import { getTreatmentsAIResult, getDoctorsVectorResult, getDoctorsAIResult, getClinicsAIResult, getDevicesAIResult, getSubTreatmentsAIResult } from "../utils/global_search.js"
import { name } from "ejs";
import { getClinicMappedTreatments } from "./clinic.js";
import { mergeGraphAwareResults } from "../utils/search_graph.util.js";
import { parseSearchIntent, isTextAllowedForIntent, normalizeSearchText } from "../search/intent_taxonomy.js";
import { restoreCanonicalBrandTerms } from "../search/protected_terms.js";
import { enforceDeviceSectionCandidates } from "../search/typed_sections.js";

//======================================= Auth =========================================

export const get_user_by_user_id = async (user_id) => {
    try {
        return await db.query(`SELECT * FROM tbl_users WHERE user_id = ?`, [user_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch user data.");
    }
};

export const get_user_by_mobile_number = async (mobile_number) => {
    try {
        return await db.query(`SELECT * FROM tbl_users WHERE mobile_number = ? AND is_deleted = 0`, [mobile_number]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch user data.");
    }
};

export const create_user = async (mobile_number, otp = '', language) => {
    try {
        const userData = {
            mobile_number,
            otp,
            language,
            is_verified: 0,
            is_active: 1,
            approval_status : "APPROVED"
        };
        return await db.query(`INSERT INTO tbl_users SET ?`, userData);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to create user.");
    }
};

export const enroll_user = async (user_data) => {
    try {
        return await db.query(`INSERT INTO tbl_users SET ?`, user_data);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to create user.");
    }
};

export const update_user = async (user_data, user_id) => {
    try {
        return await db.query(
            `UPDATE tbl_users SET ? WHERE user_id = ?`,
            [user_data, user_id]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update user.");
    }
};

export const delete_user = async (user_id) => {
    try {
        return await db.query(
            `DELETE FROM tbl_users WHERE user_id = ?`,
            [user_id]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to delete user.");
    }
};


//======================================= Ai Prompt =========================================
export const get_prompt_data = async (prompt_type) => {
    try {
        return await db.query(`SELECT * FROM tbl_aiprompt WHERE prompt_type = ?`, [prompt_type]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch prompt data.");
    }
};

export const create_prompt = async (promptData) => {
    try {
        return await db.query(`INSERT INTO  tbl_aiprompt SET ?`, promptData);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to create prompt.");
    }
};

export const update_prompt = async (prompt_data, prompt_type) => {
    try {
        return await db.query(
            `UPDATE tbl_aiprompt SET ? WHERE prompt_type = ?`,
            [prompt_data, prompt_type]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update prompt.");
    }
};


//======================================= Face Scan =========================================
export const add_face_scan_data = async (face_data) => {
    try {
        return await db.query(`INSERT INTO tbl_face_scan_results SET ?`, face_data);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to add face scan data.");
    }
};

export const update_face_scan_data = async (face_data, face_scan_result_id) => {
    try {
        return await db.query(
            `UPDATE tbl_face_scan_results 
             SET ?
             WHERE face_scan_result_id = ?`,
            [face_data, face_scan_result_id]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to update face scan data.");
    }
};


export const get_face_scan_history = async (user_id) => {
    try {
        return await db.query(
            `SELECT * FROM tbl_face_scan_results WHERE user_id = ? ORDER BY created_at DESC`, [user_id]);
    } catch (error) {
        console.error("DB Error in get_prompt_data:", error);
        throw new Error("Failed to face scan historydata");
    }
};

export const get_face_scan_history_v2 = async (user_id, face_scan_id = null) => {
    try {
        let query = `
            SELECT * 
            FROM tbl_face_scan_results 
            WHERE user_id = ?
        `;
        const params = [user_id];

        if (face_scan_id) {
            query += ` AND face_scan_result_id = ?`;
            params.push(face_scan_id);
        }

        query += ` ORDER BY created_at DESC`;

        return await db.query(query, params);
    } catch (error) {
        console.error("DB Error in get_face_scan_history_v2:", error);
        throw new Error("Failed to fetch face scan history data");
    }
};

export const get_face_scan_history_device = async (device_id = null) => {
    try {
        let query = `
            SELECT * 
            FROM tbl_face_scan_results 
            WHERE device_id = ?
        `;
        const params = [device_id];

        query += ` ORDER BY created_at DESC`;

        return await db.query(query, params);
    } catch (error) {
        console.error("DB Error in get_face_scan_history_v2:", error);
        throw new Error("Failed to fetch face scan history data");
    }
};


export const get_face_scan_result_by_id = async (user_id, face_scan_result_id) => {
    try {
        let query, params;

        if (face_scan_result_id) {
            query = `SELECT * FROM tbl_face_scan_results WHERE face_scan_result_id = ?`;
            params = [face_scan_result_id];
        } else {
            query = `SELECT * FROM tbl_face_scan_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`;
            params = [user_id];
        }

        return await db.query(query, params);
    } catch (error) {
        console.error("DB Error in get_face_scan_result_by_id:", error);
        throw new Error("Failed to fetch face scan result data");
    }
};

export const getFaceScanResultById = async (face_scan_result_id) => {
    try {
        return await db.query(`SELECT * FROM tbl_face_scan_results WHERE face_scan_result_id = ?`, [face_scan_result_id]);
    } catch (error) {
        console.error("DB Error in get_face_scan_result_by_id:", error);
        throw new Error("Failed to fetch face scan result data");
    }
};


export const delete_face_scan_result_by_id = async (face_scan_result_id) => {
    try {
        return await db.query(`DELETE FROM tbl_face_scan_results WHERE face_scan_result_id = ?`, [face_scan_result_id]);
    } catch (error) {
        console.error("DB Error in get_face_scan_result_by_id:", error);
        throw new Error("Failed to fetch face scan result data");
    }
};

export const save_test_run_scan_result = async (payload) => {
    try {
        return await db.query(`INSERT INTO tbl_test_run_scan_results SET ?`, payload);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to save test run scan result.");
    }
};

export const get_test_run_scan_results = async (scan_id = null) => {
    try {
        let query = `
            SELECT 
                test_run_scan_result_id,
                request_status,
                task_status,
                output_count,
                payload,
                created_at,
                updated_at
            FROM tbl_test_run_scan_results
        `;
        const params = [];

        if (scan_id) {
            query += ` WHERE test_run_scan_result_id = ?`;
            params.push(scan_id);
        }

        query += ` ORDER BY created_at DESC`;

        return await db.query(query, params);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch test run scan results.");
    }
};



//======================================= Doctor =========================================
export const getAllDoctors = async ({
    search = '',
    treatment_ids = [],
    skin_condition_ids = [],
    aesthetic_device_ids = [],
    skin_type_ids = [],
    surgery_ids = [],
    min_rating = null,
    sort = { by: 'default', order: 'desc' },
    limit,
    offset
}) => {
    try {
        const params = [];
        const needsRating = min_rating !== null || sort.by === 'rating';

        const selectFields = [
            'd.*',
            'zu.email',
            needsRating ? 'ROUND(AVG(ar.rating), 2) AS avg_rating' : null
        ].filter(Boolean).join(', ');

        let query = `
            SELECT ${selectFields}
            FROM tbl_doctors d
            LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
        `;

        if (needsRating) {
            query += `
                LEFT JOIN tbl_appointment_ratings ar
                       ON d.doctor_id = ar.doctor_id
                      AND ar.approval_status = 'APPROVED'
            `;
        }

        // ---------- joins for filters ----------
        const joins = [];
        const filters = [];

        const addJoinAndFilter = (ids, joinTable, alias, field) => {
            if (ids?.length) {
                joins.push(`LEFT JOIN ${joinTable} ${alias} ON d.doctor_id = ${alias}.doctor_id`);
                filters.push(`${alias}.${field} IN (${ids.map(() => '?').join(', ')})`);
                params.push(...ids);
            }
        };

        addJoinAndFilter(treatment_ids, 'tbl_doctor_treatments', 'dt', 'treatment_id');
        addJoinAndFilter(skin_condition_ids, 'tbl_doctor_skin_condition', 'dsc', 'skin_condition_id');
        addJoinAndFilter(aesthetic_device_ids, 'tbl_doctor_aesthetic_devices', 'dad', 'aesthetic_devices_id');
        addJoinAndFilter(skin_type_ids, 'tbl_doctor_skin_types', 'dst', 'skin_type_id');
        addJoinAndFilter(surgery_ids, 'tbl_doctor_surgery', 'ds', 'surgery_id');

        if (joins.length) query += ' ' + joins.join(' ');

        query += ` WHERE d.profile_status = 'VERIFIED'`;
        if (filters.length) query += ` AND ${filters.join(' AND ')}`;

        // ---------- Search clause ----------
        if (search && search.trim()) {
            const s = `%${search.toLowerCase()}%`;
            query += `
        AND (
            LOWER(d.name) LIKE ?
            OR EXISTS (
                SELECT 1
                FROM tbl_doctor_treatments sdt
                JOIN tbl_treatments t ON sdt.treatment_id = t.treatment_id
                LEFT JOIN tbl_treatment_concerns tc ON t.treatment_id = tc.treatment_id
                LEFT JOIN tbl_concerns cns ON tc.concern_id = cns.concern_id
                WHERE sdt.doctor_id = d.doctor_id
                  AND (
                      LOWER(t.name) LIKE ?
                      OR LOWER(t.swedish) LIKE ?
                      OR LOWER(t.application) LIKE ?
                      OR LOWER(t.type) LIKE ?
                      OR LOWER(t.technology) LIKE ?
                      OR LOWER(t.classification_type) LIKE ?
                      OR LOWER(t.benefits) LIKE ?
                      OR LOWER(t.benefits_en) LIKE ?
                      OR LOWER(t.benefits_sv) LIKE ?
                      OR LOWER(t.description_en) LIKE ?
                      OR LOWER(t.description_sv) LIKE ?
                      OR LOWER(tc.indications_sv) LIKE ?
                      OR LOWER(tc.indications_en) LIKE ?
                      OR LOWER(tc.likewise_terms) LIKE ?
                      OR LOWER(cns.name) LIKE ?
                      OR LOWER(cns.swedish) LIKE ?
                      OR LOWER(cns.tips) LIKE ?
                  )
            )
            OR EXISTS (
                SELECT 1
                FROM tbl_skin_types st
                JOIN tbl_skin_treatment_map stm ON st.skin_type_id = stm.skin_type_id
                JOIN tbl_treatments t2 ON stm.treatment_id = t2.treatment_id
                JOIN tbl_doctor_treatments sdt2 ON t2.treatment_id = sdt2.treatment_id AND sdt2.doctor_id = d.doctor_id
                WHERE 
                    LOWER(st.name) LIKE ?
                    OR LOWER(st.swedish) LIKE ?
                    OR LOWER(st.syn_en) LIKE ?
                    OR LOWER(st.syn_sv) LIKE ?
                    OR LOWER(st.areas) LIKE ?
                    OR LOWER(st.description) LIKE ?
                    OR LOWER(st.desc_sv) LIKE ?
            )
        )
    `;
            // push params: 1 for doctor.name + 11 treatment fields + 6 concern fields + 7 skin type fields
            params.push(s, ...Array(11).fill(s), ...Array(6).fill(s), ...Array(7).fill(s));
        }


        if (needsRating) query += ` GROUP BY d.doctor_id`;

        if (min_rating !== null) {
            query += ` HAVING avg_rating >= ?`;
            params.push(min_rating);
        }

        // ---------- Sorting ----------
        if (sort.by === 'rating') {
            query += ` ORDER BY avg_rating ${sort.order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'}`;
        } else {
            query += ` ORDER BY d.created_at DESC`;
        }

        // ---------- Pagination ----------
        query += ` LIMIT ? OFFSET ?`;
        params.push(Number(limit), Number(offset));

        return await db.query(query, params);
    } catch (err) {
        console.error('Database Error in getAllDoctors:', err);
        throw new Error('Failed to fetch doctors.');
    }
};
export const getAllRecommendedDoctors = async ({
    treatment_ids = [],
    skin_condition_ids = [],
    aesthetic_device_ids = [],
    skin_type_ids = [],
    surgery_ids = [],
    distance = {},
    price = {},
    search = '',
    min_rating = null,
    sort = { by: 'default', order: 'desc' },
    userLatitude,
    userLongitude,
    limit = 20,
    offset = 0,
    isEmptySearch = false
}) => {
    try {
        const params = [];
        const needsDistance = userLatitude != null && userLongitude != null;

        // Distance SELECT
        const distanceSelect = needsDistance
            ? `ROUND(ST_Distance_Sphere(POINT(ANY_VALUE(cl.longitude), ANY_VALUE(cl.latitude)), POINT(?, ?)), 2) AS distance`
            : null;

        if (needsDistance) {
            params.push(userLongitude, userLatitude);
        }


        const hasTreatmentPriority = isEmptySearch === true && treatment_ids.length > 0;

        const treatmentMatchSelect = hasTreatmentPriority
            ? `MAX(CASE WHEN dt.treatment_id IN (${treatment_ids.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS treatment_match`
            : null;

        if (hasTreatmentPriority) {
            params.push(...treatment_ids);
        }

        const selectFields = [
            'd.doctor_id',
            'd.name',
            `GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR ', ') AS treatment_names`,
            `GROUP_CONCAT(DISTINCT st.name ORDER BY st.name SEPARATOR ', ') AS sub_treatment_names`,
            'TIMESTAMPDIFF(YEAR, MIN(de.start_date), MAX(IFNULL(de.end_date, CURDATE()))) AS experience_years',
            'd.specialization',
            `ANY_VALUE(
                       CASE 
                          WHEN zu.role_id = '3677a3e6-3196-11f0-9e07-0e8e5d906eef' 
                          THEN dm.fee_per_session
                          ELSE d.fee_per_session
                          END
                       ) AS fee_per_session`,
            ,
            'd.profile_image',
            'dm.clinic_id',
            'c.clinic_name',
            'c.address AS clinic_address',
            'ROUND(AVG(ar.rating), 2) AS avg_rating',
            distanceSelect,
            treatmentMatchSelect
        ].filter(Boolean).join(', ');

        // Base query
        let query = `
            SELECT ${selectFields}
            FROM tbl_doctors d
            LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
            LEFT JOIN tbl_doctor_clinic_map dm ON d.doctor_id = dm.doctor_id
            LEFT JOIN tbl_clinics c ON dm.clinic_id = c.clinic_id
            LEFT JOIN tbl_clinic_locations cl ON c.clinic_id = cl.clinic_id
            LEFT JOIN tbl_appointment_ratings ar 
                   ON d.doctor_id = ar.doctor_id 
                  AND ar.approval_status = 'APPROVED'
            LEFT JOIN tbl_doctor_experiences de ON d.doctor_id = de.doctor_id
            LEFT JOIN tbl_doctor_treatments dt ON d.doctor_id = dt.doctor_id
            LEFT JOIN tbl_treatments t ON dt.treatment_id = t.treatment_id
            LEFT JOIN tbl_doctor_treatments dt2 ON d.doctor_id = dt2.doctor_id
            LEFT JOIN tbl_sub_treatment_master st ON dt2.sub_treatment_id = st.sub_treatment_id
            LEFT JOIN tbl_doctor_skin_types dst ON d.doctor_id = dst.doctor_id
        `;

        const filters = [];

        // Helper for filters
        const addFilter = (ids, alias, field) => {
            if (Array.isArray(ids) && ids.length) {
                filters.push(`${alias}.${field} IN (${ids.map(() => '?').join(', ')})`);
                params.push(...ids);
            }
        };

        if (treatment_ids.length > 0 && isEmptySearch == false) {
            addFilter(treatment_ids, 'dt', 'treatment_id');
        }
        addFilter(skin_condition_ids, 'dsc', 'skin_condition_id');
        addFilter(aesthetic_device_ids, 'dad', 'aesthetic_devices_id');
        addFilter(skin_type_ids, 'dst', 'skin_type_id');
        addFilter(surgery_ids, 'ds', 'surgery_id');

        // Verified doctors only
        query += ` WHERE d.name IS NOT NULL AND d.profile_status = 'VERIFIED' `;

        // Distance filters
        if (needsDistance) {
            if (typeof distance.min === 'number') {
                filters.push(`ST_Distance_Sphere(POINT(cl.longitude, cl.latitude), POINT(?, ?)) >= ?`);
                params.push(userLongitude, userLatitude, distance.min);
            }
            if (typeof distance.max === 'number') {
                filters.push(`ST_Distance_Sphere(POINT(cl.longitude, cl.latitude), POINT(?, ?)) <= ?`);
                params.push(userLongitude, userLatitude, distance.max);
            }
        }

        // Price filters
        if (typeof price.min === 'number') {
            filters.push(`d.fee_per_session >= ?`);
            params.push(price.min);
        }
        if (typeof price.max === 'number') {
            filters.push(`d.fee_per_session <= ?`);
            params.push(price.max);
        }

        // -------------------- SEARCH FILTER (NO AI) --------------------
        if (search && search.trim()) {
            const like = `%${search.trim()}%`;
            filters.push(`
                (
                    d.name LIKE ? OR
                    c.clinic_name LIKE ? OR
                    d.specialization LIKE ? OR
                    t.name LIKE ? OR
                    st.name LIKE ?
                )
            `);
            params.push(like, like, like, like, like);
        }

        // Apply filters
        if (filters.length) query += ` AND ${filters.join(' AND ')}`;

        // GROUPING
        query += ` GROUP BY d.doctor_id, dm.clinic_id`;

        // Rating filter
        if (min_rating !== null) {
            const ceiling = Math.min(min_rating + 1, 5.01);
            query += ` HAVING CAST(avg_rating AS DECIMAL(10,2)) >= ? AND CAST(avg_rating AS DECIMAL(10,2)) <= ?`;
            params.push(min_rating, ceiling);
        }


        // -------------------- SORTING --------------------
        if (isEmptySearch === true && hasTreatmentPriority) {
            // Priority mode: Treatment match → Distance
            if (needsDistance) {
                query += `
            ORDER BY 
                treatment_match DESC,
                distance IS NULL,
                CAST(distance AS DECIMAL(10,2)) ASC
        `;
            } else {
                query += `
            ORDER BY 
                treatment_match DESC,
                d.created_at DESC
        `;
            }
        } else {
            // Normal sorting
            if (sort.by === 'rating') {
                query += `
            ORDER BY 
                avg_rating IS NULL,
                CAST(avg_rating AS DECIMAL(10,2)) ${sort.order.toUpperCase()}
        `;
            } else if (sort.by === 'nearest' && needsDistance) {
                query += `
            ORDER BY 
                distance IS NULL,
                CAST(distance AS DECIMAL(10,2)) ${sort.order.toUpperCase()}
        `;
            } else if (sort.by === 'price') {
                query += `
            ORDER BY 
                d.fee_per_session IS NULL,
                CAST(d.fee_per_session AS DECIMAL(10,2)) ${sort.order.toUpperCase()}
        `;
            } else {
                query += ` ORDER BY d.created_at DESC `;
            }
        }


        // Run query
        const rows = await db.query(query, params);

        if (!rows?.length) return [];

        // Pagination without AI
        return rows.slice(offset, offset + limit);

    } catch (error) {
        console.error('Database Error in getAllRecommendedDoctors:', error.message);
        throw new Error('Failed to fetch doctors.');
    }
};


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
        const severityLevels = await db.query('SELECT * FROM tbl_doctor_severity_levels WHERE doctor_id = ? ORDER BY created_at DESC', [doctor_id]);
        return severityLevels;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor severity levels.");
    }
};

export const getDoctorSkinTypes = async (doctor_id) => {
    try {
        const skinTypes = await db.query('SELECT * FROM tbl_doctor_skin_types WHERE doctor_id = ? ORDER BY created_at DESC', [doctor_id]);
        return skinTypes;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor skin types.");
    }
};

export const getDoctorTreatments = async (doctor_id) => {
    try {
        const treatments = await db.query('SELECT * FROM tbl_doctor_treatments WHERE doctor_id = ? ORDER BY created_at DESC', [doctor_id]);
        return treatments;
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch doctor treatments.");
    }
};

//======================================= Product =========================================

export const get_all_products_for_user = async ({
    user_id,
    treatment_ids = [],
    search = "",
    price = {},
    sort = { by: "latest", order: "desc" },
    limit = 20,
    offset = 0
}) => {
    try {
        const trimmedSearch = (search || "").trim().toLowerCase();
        const useEmbeddings = !!trimmedSearch;

        // 1️⃣ --- Build Base Query ---
        let query = `
            SELECT 
                p.*,
                CASE WHEN cp.product_id IS NOT NULL THEN TRUE ELSE FALSE END AS added_in_cart
            FROM tbl_products p
            LEFT JOIN tbl_clinics c ON c.clinic_id = p.clinic_id
            LEFT JOIN tbl_product_treatments pt ON pt.product_id = p.product_id
            LEFT JOIN tbl_treatments t ON t.treatment_id = pt.treatment_id
            LEFT JOIN tbl_cart_products cp 
                ON cp.product_id = p.product_id
                AND cp.cart_id = (
                    SELECT c.cart_id 
                    FROM tbl_carts c 
                    WHERE c.user_id = ? 
                    LIMIT 1
                )
            WHERE p.is_hidden = 0 AND p.approval_status = 'APPROVED' AND c.profile_status = 'VERIFIED'
        `;

        const params = [user_id];

        // 2️⃣ --- Apply Filters ---
        if (treatment_ids.length > 0) {
            query += ` AND pt.treatment_id IN (${treatment_ids.map(() => "?").join(", ")})`;
            params.push(...treatment_ids);
        }

        if (typeof price?.min === "number") {
            query += ` AND p.price >= ?`;
            params.push(price.min);
        }
        if (typeof price?.max === "number") {
            query += ` AND p.price <= ?`;
            params.push(price.max);
        }

        // 3️⃣ --- Sorting ---
        let orderBy = "ORDER BY";
        if (sort.by === "price") {
            orderBy += ` p.price ${sort.order}`;
        } else {
            orderBy += ` p.created_at ${sort.order}`;
        }

        // 4️⃣ --- Handle Search Mode ---
        if (!useEmbeddings) {
            // Normal mode — DB handles pagination
            query += ` GROUP BY p.product_id ${orderBy} LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            const rows = await db.query(query, params);
            const sanitizedRows = rows.map(({ embeddings, ...rest }) => rest);
            return sanitizedRows;
        }

        // 🔍 Embedding Search Mode
        // (fetch all filtered products, no pagination here)
        query += ` GROUP BY p.product_id ${orderBy}`;
        const rows = await db.query(query, params);
        if (!rows?.length) return [];

        // 5️⃣ --- Apply Embedding Similarity ---
        const rankedRows = await getTopSimilarRows(rows, trimmedSearch);

        // 6️⃣ --- Apply Offset-based Pagination ---
        const paginatedRows = rankedRows.slice(offset, offset + limit);

        return paginatedRows;
    } catch (error) {
        console.error("Database Error in get_all_products_for_user:", error.message);
        throw new Error("Failed to fetch products.");
    }
};


export const getUserCartProduct = async (
    user_id
) => {
    try {
        let query = `
            SELECT 
                pt.product_id
            FROM tbl_carts AS ct
            LEFT JOIN tbl_cart_products AS pt ON ct.cart_id  = pt.cart_id
           
            WHERE ct.cart_status = 'CART' And ct.user_id  = '${user_id}'
        `;

        return await db.query(query);
    } catch (error) {
        console.error("Database Error in getAllProductsForUser:", error.message);
        throw new Error("Failed to fetch products.");
    }
};

export const get_single_product_for_user = async (product_id, user_id = null) => {
    try {
        const query = `
SELECT 
    p.*,
    COALESCE((
        SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'treatment_id', t.treatment_id,
                'name',         t.name,
                'swedish',      t.swedish,
                'application',  t.application,
                'type',         t.type,
                'technology',   t.technology,
                'created_at',   t.created_at
            )
        )
        FROM tbl_product_treatments pt
        INNER JOIN tbl_treatments t ON t.treatment_id = pt.treatment_id
        WHERE pt.product_id = p.product_id
        GROUP BY pt.product_id
    ), JSON_ARRAY()) AS treatments,

    -- Added in cart flag (0 if user_id is null)
    COALESCE((
        SELECT EXISTS (
            SELECT 1
            FROM tbl_cart_products cp
            INNER JOIN tbl_carts c ON c.cart_id = cp.cart_id
            WHERE cp.product_id = p.product_id
              AND c.user_id = ?
            LIMIT 1
        )
    ), 0) AS added_in_cart

FROM tbl_products p
WHERE p.product_id = ?;
        `;

        return await db.query(query, [user_id, product_id]);
    } catch (error) {
        console.error("Database Error in get_single_product_for_user:", error.message);
        throw new Error("Failed to fetch product details.");
    }
};

export const get_product_images = async (product_id) => {
    try {
        return await db.query(`SELECT * FROM tbl_product_images WHERE product_id = ? ORDER BY created_at DESC`, [product_id]);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch product images.");
    }
}


//======================================= Clinic =========================================

export const getAllClinicsForUser = async ({
    treatment_ids = [],
    skin_condition_ids = [],
    aesthetic_device_ids = [],
    skin_type_ids = [],
    surgery_ids = [],
    search = '',
    distance = {},
    price = {},
    min_rating = null,
    sort = { by: 'default', order: 'desc' },
    userLatitude,
    userLongitude,
    limit = 20,
    offset = 0
}) => {
    try {
        const params = [];
        const trimmedSearch = (search || '').trim().toLowerCase();
        const useEmbeddings = !!trimmedSearch;
        const hasLatLong = userLatitude != null && userLongitude != null;
        const needsDistanceFilter = distance.min != null || distance.max != null;
        const needsDistanceSort = sort.by === 'nearest';
        const needsDistance = hasLatLong;
        const applyDistanceFilter = hasLatLong && needsDistanceFilter;
        const applyDistanceSort = hasLatLong && needsDistanceSort;
        const hasPriceFilter = price.min != null || price.max != null;
        // --- Base SELECT ---
        const selectFields = [
            'c.clinic_id',
            'c.embeddings',
            'c.clinic_name',
            'c.clinic_logo',
            'c.address',
            'c.mobile_number',
            // 'MIN(CAST(d.fee_per_session AS DECIMAL(10,2))) AS doctor_lower_price_range',
            // 'MAX(CAST(d.fee_per_session AS DECIMAL(10,2))) AS doctor_higher_price_range',
            `MIN(
      CASE
          WHEN u.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef'
          AND d.fee_per_session IS NOT NULL
               THEN CAST(d.fee_per_session AS DECIMAL(10,2))
          WHEN u.role_id = '3677a3e6-3196-11f0-9e07-0e8e5d906eef'
          AND dcm.fee_per_session IS NOT NULL
          AND dcm.is_invitation_accepted = 1
               THEN CAST(dcm.fee_per_session AS DECIMAL(10,2))
      END
  ) AS doctor_lower_price_range`,

            `MAX(
      CASE
          WHEN u.role_id = '407595e3-3196-11f0-9e07-0e8e5d906eef'
          AND d.fee_per_session IS NOT NULL
               THEN CAST(d.fee_per_session AS DECIMAL(10,2))
          WHEN u.role_id = '3677a3e6-3196-11f0-9e07-0e8e5d906eef'
          AND dcm.fee_per_session IS NOT NULL
          AND dcm.is_invitation_accepted = 1
               THEN CAST(dcm.fee_per_session AS DECIMAL(10,2))
      END
  ) AS doctor_higher_price_range`,
            'ROUND(AVG(ar.rating), 2) AS avg_rating',
            needsDistance
                ? `ROUND(ST_Distance_Sphere(POINT(ANY_VALUE(cl.longitude), ANY_VALUE(cl.latitude)), POINT(?, ?)), 2) AS distance`
                : null
        ]
            .filter(Boolean)
            .join(', ');
        if (needsDistance) {
            params.push(userLongitude, userLatitude);
        }
        // --- FROM and JOINs ---
        let query = `
  SELECT ${selectFields}
  FROM tbl_clinics c
  LEFT JOIN tbl_clinic_locations cl ON c.clinic_id = cl.clinic_id
  LEFT JOIN tbl_doctor_clinic_map dcm ON dcm.clinic_id = c.clinic_id
  LEFT JOIN tbl_doctors d ON d.doctor_id = dcm.doctor_id

  LEFT JOIN tbl_appointments ap ON ap.clinic_id = c.clinic_id
  LEFT JOIN tbl_appointment_ratings ar 
    ON ar.appointment_id = ap.appointment_id
   AND ar.approval_status = 'APPROVED'

  LEFT JOIN tbl_zqnq_users u ON u.id = d.zynq_user_id
            `;
        const joins = [];
        const filters = [];
        const addJoinAndFilter = (ids, table, alias, column) => {
            if (ids.length > 0) {
                joins.push(`LEFT JOIN ${table} ${alias} ON c.clinic_id = ${alias}.clinic_id`);
                filters.push(`${alias}.${column} IN (${ids.map(() => '?').join(', ')})`);
                params.push(...ids);
            }
        };
        addJoinAndFilter(treatment_ids, 'tbl_mapped_clinic_treatments', 'ct', 'treatment_id');
        addJoinAndFilter(skin_condition_ids, 'tbl_clinic_skin_condition', 'csc', 'skin_condition_id');
        addJoinAndFilter(aesthetic_device_ids, 'tbl_clinic_aesthetic_devices', 'cad', 'aesthetic_devices_id');
        addJoinAndFilter(skin_type_ids, 'tbl_clinic_skin_types', 'cskt', 'skin_type_id');
        addJoinAndFilter(surgery_ids, 'tbl_clinic_surgery', 'cr', 'surgery_id');
        if (joins.length > 0) query += ' ' + joins.join(' ');
        query += ` WHERE c.profile_status = 'VERIFIED' AND c.profile_completion_percentage >= 50`;
        if (filters.length > 0) query += ` AND ${filters.join(' AND ')}`;
        query += ` GROUP BY c.clinic_id`;
        const havingConditions = [];
        if (min_rating !== null) {
            const ratingCeiling = Math.min(min_rating + 1, 5.01);
            // havingConditions.push(`COALESCE(AVG(ar.rating),0) >= ? AND COALESCE(AVG(ar.rating),0) <= ?`);
            havingConditions.push(`AVG(ar.rating) >= ? AND AVG(ar.rating) <= ?`);
            params.push(min_rating, ratingCeiling);
        }

        if (hasPriceFilter) {
            if (price.min != null) {
                havingConditions.push(`doctor_lower_price_range >= ?`);
                params.push(price.min);
            }
            if (price.max != null) {
                havingConditions.push(`doctor_higher_price_range <= ?`);
                params.push(price.max);
            }
        }

        if (applyDistanceFilter) {
            if (distance.min != null) {
                havingConditions.push(`distance >= ?`);
                params.push(distance.min);
            }
            if (distance.max != null) {
                havingConditions.push(`distance <= ?`);
                params.push(distance.max);
            }
        }

        if (havingConditions.length > 0) {
            query += ` HAVING ${havingConditions.join(' AND ')}`;
        }

        // --- Sorting ---
        if (applyDistanceSort) {
            query += ` ORDER BY distance ${sort.order.toUpperCase()}`;
        } else if (sort.by === 'rating') {
            query += ` ORDER BY avg_rating ${sort.order.toUpperCase()}`;
        } else if (sort.by === 'price') {
            query += ` ORDER BY doctor_lower_price_range ${sort.order.toUpperCase()}`;
        } else {
            query += ` ORDER BY c.created_at DESC`;
        }

        if (!useEmbeddings) {
            query += ` LIMIT ? OFFSET ?`;
            params.push(Number(limit), Number(offset));
            const rows = await db.query(query, params);

            // Remove embeddings using destructuring
            return rows.map(({ embeddings, ...rest }) => rest);
        }

        // ⚡️ EMBEDDING SEARCH MODE
        const rows = await db.query(query, params);

        if (!rows?.length) return [];

        // 3️⃣ Compute top similar rows using embedding stored in DB_sync table
        const aiRows = await getClinicsAIResult(rows, search);
        // 4️⃣ Apply pagination
        const paginatedRows = paginateRows(aiRows, limit, offset);
        return paginatedRows;
        // Apply vector-based semantic ranking
        const ranked = await getTopSimilarRows(rows, trimmedSearch, 0.3);
        // Manual offset/limit
        const paginated = ranked.slice(offset, offset + limit);
        return paginated;

    } catch (error) {
        console.error('Database Error in getAllClinicsForUser:', error.message);
        throw new Error('Failed to fetch clinics.');
    }
};

export const getNearbyClinicsForUser = async ({
    treatment_ids = [],
    skin_condition_ids = [],
    aesthetic_device_ids = [],
    skin_type_ids = [],
    surgery_ids = [],
    search = '',
    distance = {},
    price = {},
    min_rating = null,
    sort = { by: 'nearest', order: 'asc' },
    userLatitude,
    userLongitude,
    limit = 20,
    offset = 0
}) => {
    try {
        const params = [];

        const trimmedSearch = (search || '').trim().toLowerCase();
        const useEmbeddings = !!trimmedSearch;

        const hasLatLong = userLatitude != null && userLongitude != null;
        const needsDistanceFilter = distance.min != null || distance.max != null;
        const needsDistanceSort = sort.by === 'nearest';

        const needsDistance = hasLatLong;
        const applyDistanceFilter = hasLatLong && needsDistanceFilter;
        const applyDistanceSort = hasLatLong && needsDistanceSort;

        const hasPriceFilter = price.min != null || price.max != null;

        // --- SELECT ---
        const selectFields = [
            'c.clinic_id',
            'c.clinic_name',
            'c.embeddings',
            'c.clinic_logo',
            'c.address',
            'c.mobile_number',
            'MIN(CAST(d.fee_per_session AS DECIMAL(10,2))) AS doctor_lower_price_range',
            'MAX(CAST(d.fee_per_session AS DECIMAL(10,2))) AS doctor_higher_price_range',
            'ROUND(AVG(ar.rating), 2) AS avg_rating',
            needsDistance
                ? `ROUND(ST_Distance_Sphere(POINT(ANY_VALUE(cl.longitude), ANY_VALUE(cl.latitude)), POINT(?, ?)), 2) AS distance`
                : null
        ]
            .filter(Boolean)
            .join(', ');

        if (needsDistance) {
            params.push(userLongitude, userLatitude);
        }

        // --- FROM / JOINS ---
        let query = `
      SELECT ${selectFields}
      FROM tbl_clinics c
      LEFT JOIN tbl_clinic_locations cl ON c.clinic_id = cl.clinic_id
      LEFT JOIN tbl_doctor_clinic_map dcm ON dcm.clinic_id = c.clinic_id
      LEFT JOIN tbl_doctors d ON d.doctor_id = dcm.doctor_id
      LEFT JOIN tbl_appointment_ratings ar 
        ON c.clinic_id = ar.clinic_id AND ar.approval_status = 'APPROVED'
    `;

        const joins = [];
        const filters = [];

        const addJoinAndFilter = (ids, table, alias, column) => {
            if (ids.length > 0) {
                joins.push(`LEFT JOIN ${table} ${alias} ON c.clinic_id = ${alias}.clinic_id`);
                filters.push(`${alias}.${column} IN (${ids.map(() => '?').join(', ')})`);
                params.push(...ids);
            }
        };

        addJoinAndFilter(treatment_ids, 'tbl_mapped_clinic_treatments', 'ct', 'treatment_id');
        addJoinAndFilter(skin_condition_ids, 'tbl_clinic_skin_condition', 'csc', 'skin_condition_id');
        addJoinAndFilter(aesthetic_device_ids, 'tbl_clinic_aesthetic_devices', 'cad', 'aesthetic_devices_id');
        addJoinAndFilter(skin_type_ids, 'tbl_clinic_skin_types', 'cskt', 'skin_type_id');
        addJoinAndFilter(surgery_ids, 'tbl_clinic_surgery', 'cr', 'surgery_id');

        if (joins.length > 0) query += ' ' + joins.join(' ');

        // --- Filters ---
        query += ` WHERE c.profile_status = 'VERIFIED' AND c.profile_completion_percentage >= 50 AND c.is_deleted = 0 `;
        if (filters.length > 0) query += ` AND ${filters.join(' AND ')}`;

        // --- GROUP BY ---
        query += ` GROUP BY c.clinic_id`;

        // --- HAVING ---
        const havingConditions = [];
        if (min_rating != null) {
            const ratingCeiling = Math.min(min_rating + 1, 5.01);
            havingConditions.push(`CAST(avg_rating AS DECIMAL(10,2)) >= ? AND CAST(avg_rating AS DECIMAL(10,2)) <= ?`);
            params.push(min_rating, ratingCeiling);
        }

        if (hasPriceFilter) {
            if (price.min != null) {
                havingConditions.push(`doctor_lower_price_range >= ?`);
                params.push(price.min);
            }
            if (price.max != null) {
                havingConditions.push(`doctor_higher_price_range <= ?`);
                params.push(price.max);
            }
        }

        if (applyDistanceFilter) {
            if (distance.min != null) {
                havingConditions.push(`distance >= ?`);
                params.push(distance.min);
            }
            if (distance.max != null) {
                havingConditions.push(`distance <= ?`);
                params.push(distance.max);
            }
        }

        if (havingConditions.length > 0) {
            query += ` HAVING ${havingConditions.join(' AND ')}`;
        }

        // --- Sorting ---
        if (applyDistanceSort) {
            query += ` ORDER BY distance ${sort.order.toUpperCase()}`;
        } else if (sort.by === 'rating') {
            query += ` ORDER BY avg_rating ${sort.order.toUpperCase()}`;
        } else if (sort.by === 'price') {
            query += ` ORDER BY doctor_lower_price_range ${sort.order.toUpperCase()}`;
        } else {
            query += ` ORDER BY c.created_at DESC`;
        }

        // --- Normal Mode ---
        if (!useEmbeddings) {
            query += ` LIMIT ? OFFSET ?`;
            params.push(Number(limit), Number(offset));
            const rows = await db.query(query, params);

            // Strip embeddings cleanly using destructuring
            return rows.map(({ embeddings, ...rest }) => rest);
        }

        // --- Embedding Mode (NO PREFILTER_LIMIT) ---
        const rows = await db.query(query, params);
        if (!rows?.length) return [];

        const ranked = await getTopSimilarRows(rows, trimmedSearch, 0.3);

        const paginated = ranked.slice(offset, offset + limit);
        return paginated;

    } catch (error) {
        console.error('Database Error in getNearbyClinicsForUser:', error.message);
        throw new Error('Failed to fetch nearby clinics.');
    }
};

export const getSingleClinicForUser = async (
    clinic_id,
) => {
    try {
        const params = [];

        const selectFields = [
            'c.*',
            'MIN(CAST(d.fee_per_session AS DECIMAL(10,2))) AS doctor_lower_price_range',
            'MAX(CAST(d.fee_per_session AS DECIMAL(10,2))) AS doctor_higher_price_range',
            'ROUND(AVG(ar.rating), 2) AS avg_rating'
        ].filter(Boolean).join(', ');

        let query = `
            SELECT ${selectFields}
            FROM tbl_clinics c
            LEFT JOIN tbl_clinic_locations cl ON c.clinic_id = cl.clinic_id
            LEFT JOIN tbl_doctor_clinic_map dcm ON dcm.clinic_id = c.clinic_id
            LEFT JOIN tbl_doctors d ON d.doctor_id = dcm.doctor_id
            LEFT JOIN tbl_appointment_ratings ar ON c.clinic_id = ar.clinic_id AND ar.approval_status = 'APPROVED'
            WHERE c.clinic_id = ?
        `;

        params.push(clinic_id);

        query += ` GROUP BY c.clinic_id`;
        return await db.query(query, params);
    } catch (error) {
        console.error("Database Error in getSingleClinicDetailsForUser:", error.message);
        throw new Error("Failed to fetch clinic details.");
    }
};

export const get_clinic_by_zynq_user_id = async (zynq_user_id) => {
    try {
        return await db.query(`SELECT * FROM tbl_clinics WHERE zynq_user_id = ?`, [zynq_user_id]);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic.");
    }
}


//======================================= Support =========================================
export const insert_support_ticket = async (support_ticket_data) => {
    try {
        return await db.query(`INSERT INTO tbl_support_tickets SET ?`, support_ticket_data);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to insert support ticket.");
    }
}

export const get_support_tickets_by_user_id = async (user_id) => {
    try {
        return await db.query(`SELECT * FROM tbl_support_tickets WHERE user_id = ? ORDER BY created_at DESC`, [user_id]);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch support tickets.");
    }
}


export const update_user_is_online = async (user_id, isOnline) => {
    return db.query("UPDATE tbl_users SET isOnline = ? WHERE user_id = ?", [isOnline, user_id]);
};

export const fetchAllCallLogsWithDetails = async () => {
    try {
        const result = await db.query(`
      SELECT
        cl.*,
 
        su.user_id AS su_id, su.full_name AS su_name, su.mobile_number AS su_mobile,
        ru.user_id AS ru_id, ru.full_name AS ru_name, ru.mobile_number AS ru_mobile,
 
        sd.doctor_id AS sd_id, sd.name AS sd_name, sd.specialization AS sd_specialization,
        rd.doctor_id AS rd_id, rd.name AS rd_name, rd.specialization AS rd_specialization
 
      FROM tbl_call_logs cl
      LEFT JOIN tbl_users su ON cl.sender_user_id = su.user_id
      LEFT JOIN tbl_users ru ON cl.receiver_user_id = ru.user_id
      LEFT JOIN tbl_doctors sd ON cl.sender_doctor_id = sd.doctor_id
      LEFT JOIN tbl_doctors rd ON cl.receiver_doctor_id = rd.doctor_id
 
      ORDER BY cl.created_at DESC
    `);

        return Array.isArray(result) ? result : result;
    } catch (error) {
        console.error('❌ SQL ERROR:', error);
        throw new Error("Database error while fetching call logs.");
    }
};

export const get_all_appointments = async () => {
    try {
        const result = await db.query(`
            SELECT
                a.appointment_id,
                a.start_time,
                a.end_time,
                a.type,
                a.status,
 
                u.user_id AS user_id,
                u.full_name AS user_name,
                u.mobile_number AS user_mobile,
                u.email AS email,
                u.age AS age,
                u.gender AS gender,
                u.profile_image AS user_profile_image,
 
                d.doctor_id AS doctor_id,
                d.name AS doctor_name,
                d.age AS age,
                d.address,
                d.biography,
                d.profile_image AS doctor_image,
                d.experience_years,
                IFNULL(ar.rating, 0) AS rating,
                d.phone,
                d.fee_per_session,
 
                c.clinic_id AS clinic_id,
                c.clinic_name,
                c.email AS clinic_email,
                c.mobile_number AS clinic_mobile,
                c.address,

                fcr.face_scan_result_id,
                fcr.pdf
 
            FROM tbl_appointments a
            LEFT JOIN tbl_users u ON a.user_id = u.user_id
            LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
            LEFT JOIN tbl_clinics c ON a.clinic_id = c.clinic_id
            LEFT JOIN tbl_face_scan_results fcr ON fcr.face_scan_result_id = a.report_id
            LEFT JOIN tbl_appointment_ratings ar ON a.appointment_id = ar.appointment_id
            WHERE a.payment_status != 'unpaid'
            ORDER BY a.created_at DESC
        `);

        return Array.isArray(result) ? result : result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch appointments");
    }
};

export const get_single_appointments = async (appointment_id) => {
    try {
        const result = await db.query(`
            SELECT
                a.appointment_id,
                a.start_time,
                a.end_time,
                a.type,
                a.status,
 
                u.user_id AS user_id,
                u.full_name AS user_name,
                u.mobile_number AS user_mobile,
                u.email AS email,
                u.age AS age,
                u.gender AS gender,
                u.profile_image AS user_profile_image,
 
                d.doctor_id AS doctor_id,
                d.name AS doctor_name,
                d.age AS age,
                d.address,
                d.biography,
                d.profile_image AS doctor_image,
                d.experience_years,
                IFNULL(ar.rating, 0) AS rating,
                d.phone,
                d.fee_per_session,
 
                c.clinic_id AS clinic_id,
                c.clinic_name,
                c.email AS clinic_email,
                c.mobile_number AS clinic_mobile,
                c.address,

                fcr.face_scan_result_id,
                fcr.pdf
 
            FROM tbl_appointments a
            LEFT JOIN tbl_users u ON a.user_id = u.user_id
            LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
            LEFT JOIN tbl_clinics c ON a.clinic_id = c.clinic_id
            LEFT JOIN tbl_face_scan_results fcr ON fcr.face_scan_result_id = a.report_id
            LEFT JOIN tbl_appointment_ratings ar ON a.appointment_id = ar.appointment_id
            WHERE a.payment_status != 'unpaid' AND a.appointment_id = ?
            ORDER BY a.created_at DESC
        ` , [appointment_id]);

        return Array.isArray(result) ? result : result;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch appointments");
    }
};


export const fetchZynqUserByUserId = async (user_id) => {
    try {
        return await db.query(`SELECT * FROM tbl_zqnq_users WHERE id = ?`, [user_id]);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic.");
    }
}

export const getAllConcerns = async (lang = "en", concern_ids) => {
    try {
        let query = `
            SELECT *
            FROM tbl_concerns
            WHERE is_deleted = 0 AND approval_status = 'APPROVED'     
        `;
        const params = [];

        if (Array.isArray(concern_ids) && concern_ids.length > 0) {
            const placeholders = concern_ids.map(() => '?').join(',');
            query += `   AND concern_id IN (${placeholders})`;
            params.push(...concern_ids);
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

export const getTreatmentsByConcernId = async (concern_id) => {
    try {
        const results = await db.query(`
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
                t.embeddings,
                t.name_embeddings,
                t.created_at,

                IFNULL(pagg.min_price, 0) AS min_price,
                IFNULL(pagg.max_price, 0) AS max_price,

                cagg.concerns,
                lwtagg.like_wise_terms,
                lwtagg.like_wise_terms_swedish,
                dagg.device_name,
                dagg.device_name_swedish,
                bagg.benefits_en,
                bagg.benefits_sv

            FROM tbl_treatments t

            /* ---- filter by single concern ---- */
            INNER JOIN tbl_treatment_concerns tcf
                ON tcf.treatment_id = t.treatment_id
               AND tcf.concern_id = ?

            /* ---- prices ---- */
            LEFT JOIN (
                SELECT
                    treatment_id,
                    MIN(price) AS min_price,
                    MAX(price) AS max_price
                FROM tbl_doctor_treatments
                GROUP BY treatment_id
            ) pagg ON pagg.treatment_id = t.treatment_id

            /* ---- concerns ---- */
            LEFT JOIN (
                SELECT
                    tc.treatment_id,
                    JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'concern_id', c.concern_id,
                            'name', c.name
                        )
                    ) AS concerns
                FROM tbl_treatment_concerns tc
                JOIN tbl_concerns c
                    ON c.concern_id = tc.concern_id
                GROUP BY tc.treatment_id
            ) cagg ON cagg.treatment_id = t.treatment_id

            /* ---- like wise terms ---- */
            LEFT JOIN (
                SELECT
                    tlwt.treatment_id,
                    GROUP_CONCAT(DISTINCT lwt.name ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms,
                    GROUP_CONCAT(DISTINCT lwt.swedish ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms_swedish
                FROM tbl_treatment_like_wise_terms tlwt
                JOIN tbl_likewise_terms lwt
                    ON lwt.like_wise_term_id = tlwt.like_wise_term_id
                   AND lwt.is_deleted = 0
                   AND lwt.approval_status = 'APPROVED'
                GROUP BY tlwt.treatment_id
            ) lwtagg ON lwtagg.treatment_id = t.treatment_id

            /* ---- devices ---- */
            LEFT JOIN (
                SELECT
                    d.treatment_id,
                    GROUP_CONCAT(DISTINCT tbd.name ORDER BY tbd.name SEPARATOR ',') AS device_name,
                    GROUP_CONCAT(DISTINCT tbd.swedish ORDER BY tbd.name SEPARATOR ',') AS device_name_swedish
                FROM tbl_treatment_devices d
                JOIN tbl_devices tbd
                    ON tbd.device_id = d.device_id
                   AND tbd.is_deleted = 0
                   AND tbd.approval_status = 'APPROVED'
                GROUP BY d.treatment_id
            ) dagg ON dagg.treatment_id = t.treatment_id

            /* ---- benefits ---- */
            LEFT JOIN (
                SELECT
                    ttb.treatment_id,
                    GROUP_CONCAT(DISTINCT tb.name ORDER BY tb.name SEPARATOR ',') AS benefits_en,
                    GROUP_CONCAT(DISTINCT tb.swedish ORDER BY tb.name SEPARATOR ',') AS benefits_sv
                FROM tbl_treatment_benefits ttb
                JOIN tbl_benefits tb
                    ON tb.benefit_id = ttb.benefit_id
                   AND tb.is_deleted = 0
                   AND tb.approval_status = 'APPROVED'
                GROUP BY ttb.treatment_id
            ) bagg ON bagg.treatment_id = t.treatment_id

            WHERE t.is_deleted = 0
              AND t.approval_status = 'APPROVED'
        `, [concern_id]);

        // Remove embeddings dynamically
        const cleanedResults = results.map(row => {
            const treatmentRow = { ...row };
            if ('embeddings' in treatmentRow) delete treatmentRow.embeddings;
            return treatmentRow;
        });

        return cleanedResults;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch treatments by concern.");
    }
};


export const enroll_user_data = async (user_data) => {
    try {
        return await db.query(`INSERT INTO  tbl_enrollments  SET?`, user_data);
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to create user.");
    }
};

export const get_all_enrollments = async () => {
    try {
        return await db.query(`SELECT * FROM tbl_enrollments
                ORDER BY created_at DESC`, []);
    }
    catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch clinic.");
    }
};

export const getTreatmentsByConcernIds = async (concern_ids = [], lang) => {
    if (!Array.isArray(concern_ids) || concern_ids.length === 0) return [];

    try {
        const placeholders = concern_ids.map(() => '?').join(', ');

        const query = `
            SELECT DISTINCT
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
                t.embeddings,
                t.name_embeddings,
                t.created_at,

                IFNULL(pagg.min_price, 0) AS min_price,
                IFNULL(pagg.max_price, 0) AS max_price,

                cagg.concerns,
                lwtagg.like_wise_terms,
                lwtagg.like_wise_terms_swedish,
                dagg.device_name,
                dagg.device_name_swedish,
                bagg.benefits_en,
                bagg.benefits_sv

            FROM tbl_treatments t

            /* -------- Filter treatments by concern IDs -------- */
            INNER JOIN tbl_treatment_concerns tcf
                ON tcf.treatment_id = t.treatment_id
               AND tcf.concern_id IN (${placeholders})

            /* -------- Prices -------- */
            LEFT JOIN (
                SELECT
                    treatment_id,
                    MIN(price) AS min_price,
                    MAX(price) AS max_price
                FROM tbl_doctor_treatments
                GROUP BY treatment_id
            ) pagg ON pagg.treatment_id = t.treatment_id

            /* -------- Concerns -------- */
            LEFT JOIN (
                SELECT
                    tc.treatment_id,
                    JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'concern_id', c.concern_id,
                            'name', c.name
                        )
                    ) AS concerns
                FROM tbl_treatment_concerns tc
                JOIN tbl_concerns c
                    ON c.concern_id = tc.concern_id
                GROUP BY tc.treatment_id
            ) cagg ON cagg.treatment_id = t.treatment_id

            /* -------- Like Wise Terms -------- */
            LEFT JOIN (
                SELECT
                    tlwt.treatment_id,
                    GROUP_CONCAT(DISTINCT lwt.name ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms,
                    GROUP_CONCAT(DISTINCT lwt.swedish ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms_swedish
                FROM tbl_treatment_like_wise_terms tlwt
                JOIN tbl_likewise_terms lwt
                    ON lwt.like_wise_term_id = tlwt.like_wise_term_id
                   AND lwt.is_deleted = 0
                   AND lwt.approval_status = 'APPROVED'
                GROUP BY tlwt.treatment_id
            ) lwtagg ON lwtagg.treatment_id = t.treatment_id

            /* -------- Devices -------- */
            LEFT JOIN (
                SELECT
                    d.treatment_id,
                    GROUP_CONCAT(DISTINCT tbd.name ORDER BY tbd.name SEPARATOR ',') AS device_name,
                    GROUP_CONCAT(DISTINCT tbd.swedish ORDER BY tbd.name SEPARATOR ',') AS device_name_swedish
                FROM tbl_treatment_devices d
                JOIN tbl_devices tbd
                    ON tbd.device_id = d.device_id
                   AND tbd.is_deleted = 0
                   AND tbd.approval_status = 'APPROVED'
                GROUP BY d.treatment_id
            ) dagg ON dagg.treatment_id = t.treatment_id

            /* -------- Benefits -------- */
            LEFT JOIN (
                SELECT
                    ttb.treatment_id,
                    GROUP_CONCAT(DISTINCT tb.name ORDER BY tb.name SEPARATOR ',') AS benefits_en,
                    GROUP_CONCAT(DISTINCT tb.swedish ORDER BY tb.name SEPARATOR ',') AS benefits_sv
                FROM tbl_treatment_benefits ttb
                JOIN tbl_benefits tb
                    ON tb.benefit_id = ttb.benefit_id
                   AND tb.is_deleted = 0
                   AND tb.approval_status = 'APPROVED'
                GROUP BY ttb.treatment_id
            ) bagg ON bagg.treatment_id = t.treatment_id

            WHERE t.is_deleted = 0
              AND t.approval_status = 'APPROVED'
        `;

        let results = await db.query(query, concern_ids);

        // Remove embeddings dynamically
        results = results.map(row => {
            const treatmentRow = { ...row };
            if ('embeddings' in treatmentRow) delete treatmentRow.embeddings;
            if ('name_embeddings' in treatmentRow) delete treatmentRow.name_embeddings;
            return treatmentRow;
        });

        // Format benefits based on language
        return formatBenefitsUnified(results, lang);

    } catch (error) {
        console.error("Database Error in getTreatmentsByConcernIds:", error.message);
        throw new Error("Failed to fetch treatments by concern IDs.");
    }
};
// export const getTreatmentsByConcernIds = async (concern_ids = [], lang) => {
//     if (!Array.isArray(concern_ids) || concern_ids.length === 0) return [];

//     try {
//         const placeholders = concern_ids.map(() => '?').join(', ');

//         const query = `
//             SELECT
//                 t.treatment_id,
//                 t.name,
//                 t.swedish,
//                 t.classification_type,
//                 t.description_en,
//                 t.description_sv,
//                 t.technology,
//                 t.type,
//                 t.source,
//                 t.application,
//                 t.is_device,
//                 t.is_admin_created,
//                 t.created_by_zynq_user_id,
//                 t.approval_status,
//                 t.is_deleted,
//                 t.embeddings,
//                 t.name_embeddings,
//                 t.created_at,

//                 IFNULL(pagg.min_price, 0) AS min_price,
//                 IFNULL(pagg.max_price, 0) AS max_price,

//                 cagg.concerns,
//                 lwtagg.like_wise_terms,
//                 lwtagg.like_wise_terms_swedish,
//                 dagg.device_name,
//                 dagg.device_name_swedish,
//                 bagg.benefits_en,
//                 bagg.benefits_sv

//             FROM tbl_treatments t

//             /* -------- Filter treatments by concern IDs -------- */
//             INNER JOIN tbl_treatment_concerns tcf
//                 ON tcf.treatment_id = t.treatment_id
//                AND tcf.concern_id IN (${placeholders})

//             /* -------- Prices -------- */
//             LEFT JOIN (
//                 SELECT
//                     treatment_id,
//                     MIN(price) AS min_price,
//                     MAX(price) AS max_price
//                 FROM tbl_doctor_treatments
//                 GROUP BY treatment_id
//             ) pagg ON pagg.treatment_id = t.treatment_id

//             /* -------- Concerns -------- */
//             LEFT JOIN (
//                 SELECT
//                     tc.treatment_id,
//                     JSON_ARRAYAGG(
//                         JSON_OBJECT(
//                             'concern_id', c.concern_id,
//                             'name', c.name
//                         )
//                     ) AS concerns
//                 FROM tbl_treatment_concerns tc
//                 JOIN tbl_concerns c
//                     ON c.concern_id = tc.concern_id
//                 GROUP BY tc.treatment_id
//             ) cagg ON cagg.treatment_id = t.treatment_id

//             /* -------- Like Wise Terms -------- */
//             LEFT JOIN (
//                 SELECT
//                     tlwt.treatment_id,
//                     GROUP_CONCAT(DISTINCT lwt.name ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms,
//                     GROUP_CONCAT(DISTINCT lwt.swedish ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms_swedish
//                 FROM tbl_treatment_like_wise_terms tlwt
//                 JOIN tbl_likewise_terms lwt
//                     ON lwt.like_wise_term_id = tlwt.like_wise_term_id
//                    AND lwt.is_deleted = 0
//                    AND lwt.approval_status = 'APPROVED'
//                 GROUP BY tlwt.treatment_id
//             ) lwtagg ON lwtagg.treatment_id = t.treatment_id

//             /* -------- Devices -------- */
//             LEFT JOIN (
//                 SELECT
//                     d.treatment_id,
//                     GROUP_CONCAT(DISTINCT tbd.name ORDER BY tbd.name SEPARATOR ',') AS device_name,
//                     GROUP_CONCAT(DISTINCT tbd.swedish ORDER BY tbd.name SEPARATOR ',') AS device_name_swedish
//                 FROM tbl_treatment_devices d
//                 JOIN tbl_devices tbd
//                     ON tbd.device_id = d.device_id
//                    AND tbd.is_deleted = 0
//                    AND tbd.approval_status = 'APPROVED'
//                 GROUP BY d.treatment_id
//             ) dagg ON dagg.treatment_id = t.treatment_id

//             /* -------- Benefits -------- */
//             LEFT JOIN (
//                 SELECT
//                     ttb.treatment_id,
//                     GROUP_CONCAT(DISTINCT tb.name ORDER BY tb.name SEPARATOR ',') AS benefits_en,
//                     GROUP_CONCAT(DISTINCT tb.swedish ORDER BY tb.name SEPARATOR ',') AS benefits_sv
//                 FROM tbl_treatment_benefits ttb
//                 JOIN tbl_benefits tb
//                     ON tb.benefit_id = ttb.benefit_id
//                    AND tb.is_deleted = 0
//                    AND tb.approval_status = 'APPROVED'
//                 GROUP BY ttb.treatment_id
//             ) bagg ON bagg.treatment_id = t.treatment_id

//             WHERE t.is_deleted = 0
//               AND t.approval_status = 'APPROVED'
              
//         `;

//         let results = await db.query(query, concern_ids);

//         // Remove embeddings dynamically
//         results = results.map(row => {
//             const treatmentRow = { ...row };
//             if ('embeddings' in treatmentRow) delete treatmentRow.embeddings;
//             if ('name_embeddings' in treatmentRow) delete treatmentRow.name_embeddings;
//             return treatmentRow;
//         });

//         // Format benefits based on language
//         return formatBenefitsUnified(results, lang);

//     } catch (error) {
//         console.error("Database Error in getTreatmentsByConcernIds:", error.message);
//         throw new Error("Failed to fetch treatments by concern IDs.");
//     }
// };

//AIshwarya Holkar changes 
export const getTreatmentsByIds = async (concern_ids = [], lang) => {
    if (!Array.isArray(concern_ids) || concern_ids.length === 0) return [];

    try {
        const placeholders = concern_ids.map(() => '?').join(', ');

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
    t.embeddings,
    t.name_embeddings,
    t.created_at,

    IFNULL(pagg.min_price, 0) AS min_price,
    IFNULL(pagg.max_price, 0) AS max_price,

    cagg.concerns AS concern_name,

    lwtagg.like_wise_terms,
    lwtagg.like_wise_terms_swedish,

    dagg.device_name,
    dagg.device_name_swedish,

    bagg.benefits_en,
    bagg.benefits_sv

FROM tbl_treatments t

/* ---------------- Prices ---------------- */
LEFT JOIN (
    SELECT
        treatment_id,
        MIN(price) AS min_price,
        MAX(price) AS max_price
    FROM tbl_doctor_treatments
    GROUP BY treatment_id
) pagg
    ON pagg.treatment_id = t.treatment_id

/* ---------------- Concerns ---------------- */
LEFT JOIN (
    SELECT
        tc.treatment_id,
        JSON_ARRAYAGG(
            JSON_OBJECT(
                'concern_id', c.concern_id,
                'name', c.name
            )
        ) AS concerns
    FROM tbl_treatment_concerns tc
    JOIN tbl_concerns c
        ON c.concern_id = tc.concern_id
    GROUP BY tc.treatment_id
) cagg
    ON cagg.treatment_id = t.treatment_id

/* ---------------- Like Wise Terms ---------------- */
LEFT JOIN (
    SELECT
        tlwt.treatment_id,
        GROUP_CONCAT(DISTINCT lwt.name ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms,
        GROUP_CONCAT(DISTINCT lwt.swedish ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms_swedish
    FROM tbl_treatment_like_wise_terms tlwt
    JOIN tbl_likewise_terms lwt
        ON lwt.like_wise_term_id = tlwt.like_wise_term_id
       AND lwt.is_deleted = 0
       AND lwt.approval_status = 'APPROVED'
    GROUP BY tlwt.treatment_id
) lwtagg
    ON lwtagg.treatment_id = t.treatment_id

/* ---------------- Devices ---------------- */
LEFT JOIN (
    SELECT
        d.treatment_id,
        GROUP_CONCAT(DISTINCT tbd.name ORDER BY tbd.name SEPARATOR ',') AS device_name,
        GROUP_CONCAT(DISTINCT tbd.swedish ORDER BY tbd.name SEPARATOR ',') AS device_name_swedish
    FROM tbl_treatment_devices d
    JOIN tbl_devices tbd
        ON tbd.device_id = d.device_id
       AND tbd.is_deleted = 0
       AND tbd.approval_status = 'APPROVED'
    GROUP BY d.treatment_id
) dagg
    ON dagg.treatment_id = t.treatment_id

/* ---------------- Benefits ---------------- */
LEFT JOIN (
    SELECT
        ttb.treatment_id,
        GROUP_CONCAT(DISTINCT tb.name ORDER BY tb.name SEPARATOR ',') AS benefits_en,
        GROUP_CONCAT(DISTINCT tb.swedish ORDER BY tb.name SEPARATOR ',') AS benefits_sv
    FROM tbl_treatment_benefits ttb
    JOIN tbl_benefits tb
        ON tb.benefit_id = ttb.benefit_id
       AND tb.is_deleted = 0
       AND tb.approval_status = 'APPROVED'
    GROUP BY ttb.treatment_id
) bagg
    ON bagg.treatment_id = t.treatment_id

WHERE t.is_deleted = 0
  AND t.approval_status = 'APPROVED' AND t.treatment_id  IN (${placeholders})
        `;

        let results = await db.query(query, concern_ids);

        // Remove embeddings dynamically
        results = results.map(row => {
            const treatmentRow = { ...row };
            if ('embeddings' in treatmentRow) delete treatmentRow.embeddings;
            if ('name_embeddings' in treatmentRow) delete treatmentRow.name_embeddings;
            return treatmentRow;
        });

        // Format benefits based on language
        return formatBenefitsUnified(results, lang);

    } catch (error) {
        console.error("Database Error in getTreatmentsByConcernIds:", error.message);
        throw new Error("Failed to fetch treatments by concern IDs.");
    }
};
export const getAllTreatments = async (lang) => {
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
    t.embeddings,
    t.name_embeddings,
    t.created_at,

    IFNULL(pagg.min_price, 0) AS min_price,
    IFNULL(pagg.max_price, 0) AS max_price,

    cagg.concerns AS concern_name,

    lwtagg.like_wise_terms,
    lwtagg.like_wise_terms_swedish,

    dagg.device_name,
    dagg.device_name_swedish,

    bagg.benefits_en,
    bagg.benefits_sv

FROM tbl_treatments t

/* ---------------- Prices ---------------- */
LEFT JOIN (
    SELECT
        treatment_id,
        MIN(price) AS min_price,
        MAX(price) AS max_price
    FROM tbl_doctor_treatments
    GROUP BY treatment_id
) pagg
    ON pagg.treatment_id = t.treatment_id

/* ---------------- Concerns ---------------- */
LEFT JOIN (
    SELECT
        tc.treatment_id,
        JSON_ARRAYAGG(
            JSON_OBJECT(
                'concern_id', c.concern_id,
                'name', c.name
            )
        ) AS concerns
    FROM tbl_treatment_concerns tc
    JOIN tbl_concerns c
        ON c.concern_id = tc.concern_id
    GROUP BY tc.treatment_id
) cagg
    ON cagg.treatment_id = t.treatment_id

/* ---------------- Like Wise Terms ---------------- */
LEFT JOIN (
    SELECT
        tlwt.treatment_id,
        GROUP_CONCAT(DISTINCT lwt.name ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms,
        GROUP_CONCAT(DISTINCT lwt.swedish ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms_swedish
    FROM tbl_treatment_like_wise_terms tlwt
    JOIN tbl_likewise_terms lwt
        ON lwt.like_wise_term_id = tlwt.like_wise_term_id
       AND lwt.is_deleted = 0
       AND lwt.approval_status = 'APPROVED'
    GROUP BY tlwt.treatment_id
) lwtagg
    ON lwtagg.treatment_id = t.treatment_id

/* ---------------- Devices ---------------- */
LEFT JOIN (
    SELECT
        d.treatment_id,
        GROUP_CONCAT(DISTINCT tbd.name ORDER BY tbd.name SEPARATOR ',') AS device_name,
        GROUP_CONCAT(DISTINCT tbd.swedish ORDER BY tbd.name SEPARATOR ',') AS device_name_swedish
    FROM tbl_treatment_devices d
    JOIN tbl_devices tbd
        ON tbd.device_id = d.device_id
       AND tbd.is_deleted = 0
       AND tbd.approval_status = 'APPROVED'
    GROUP BY d.treatment_id
) dagg
    ON dagg.treatment_id = t.treatment_id

/* ---------------- Benefits ---------------- */
LEFT JOIN (
    SELECT
        ttb.treatment_id,
        GROUP_CONCAT(DISTINCT tb.name ORDER BY tb.name SEPARATOR ',') AS benefits_en,
        GROUP_CONCAT(DISTINCT tb.swedish ORDER BY tb.name SEPARATOR ',') AS benefits_sv
    FROM tbl_treatment_benefits ttb
    JOIN tbl_benefits tb
        ON tb.benefit_id = ttb.benefit_id
       AND tb.is_deleted = 0
       AND tb.approval_status = 'APPROVED'
    GROUP BY ttb.treatment_id
) bagg
    ON bagg.treatment_id = t.treatment_id

WHERE t.is_deleted = 0
  AND t.approval_status = 'APPROVED';
        `;

        let results = await db.query(query);

        // Remove embeddings dynamically
        results = results.map(row => {
            const treatmentRow = { ...row };
            if ('embeddings' in treatmentRow) delete treatmentRow.embeddings;
            return treatmentRow;
        });

        // Format benefits based on language
        return formatBenefitsUnified(results, lang);

    } catch (error) {
        console.error("Database Error in getAllTreatments:", error.message);
        throw new Error("Failed to fetch all treatments.");
    }
};

export const getAllTreatmentsV2 = async (filters = {}, lang = 'en', user_id = null) => {
    try {
        const nameColumn = lang === 'sv' ? 't.swedish' : 't.name';
        const concernNameColumn = lang === 'sv' ? 'c.swedish' : 'c.name';
        const descriptionColumn = lang === 'sv' ? 't.description_sv' : 't.description_en';

        // ---------- BASE QUERY (keeps 1 WHERE only) ----------
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
    t.embeddings,
    t.name_embeddings,
    t.created_at,

    IFNULL(pagg.min_price, 0) AS min_price,
    IFNULL(pagg.max_price, 0) AS max_price,

    cagg.concerns,

    lwtagg.like_wise_terms,
    lwtagg.like_wise_terms_swedish,

    dagg.device_name,
    dagg.device_name_swedish,

    bagg.benefits_en,
    bagg.benefits_sv

FROM tbl_treatments t

/* ---------------- Prices ---------------- */
LEFT JOIN (
    SELECT
        treatment_id,
        MIN(price) AS min_price,
        MAX(price) AS max_price
    FROM tbl_doctor_treatments
    GROUP BY treatment_id
) pagg
    ON pagg.treatment_id = t.treatment_id

/* ---------------- Concerns ---------------- */
LEFT JOIN (
    SELECT
        tc.treatment_id,
        JSON_ARRAYAGG(
            JSON_OBJECT(
                'concern_id', c.concern_id,
                'name', ${concernNameColumn}
            )
        ) AS concerns
    FROM tbl_treatment_concerns tc
    JOIN tbl_concerns c
        ON c.concern_id = tc.concern_id
    GROUP BY tc.treatment_id
) cagg
    ON cagg.treatment_id = t.treatment_id

/* ---------------- Like Wise Terms ---------------- */
LEFT JOIN (
    SELECT
        tlwt.treatment_id,
        GROUP_CONCAT(DISTINCT lwt.name ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms,
        GROUP_CONCAT(DISTINCT lwt.swedish ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms_swedish
    FROM tbl_treatment_like_wise_terms tlwt
    JOIN tbl_likewise_terms lwt
        ON lwt.like_wise_term_id = tlwt.like_wise_term_id
       AND lwt.is_deleted = 0
       AND lwt.approval_status = 'APPROVED'
    GROUP BY tlwt.treatment_id
) lwtagg
    ON lwtagg.treatment_id = t.treatment_id

/* ---------------- Devices ---------------- */
LEFT JOIN (
    SELECT
        d.treatment_id,
        GROUP_CONCAT(DISTINCT tbd.name ORDER BY tbd.name SEPARATOR ',') AS device_name,
        GROUP_CONCAT(DISTINCT tbd.swedish ORDER BY tbd.name SEPARATOR ',') AS device_name_swedish
    FROM tbl_treatment_devices d
    JOIN tbl_devices tbd
        ON tbd.device_id = d.device_id
       AND tbd.is_deleted = 0
       AND tbd.approval_status = 'APPROVED'
    GROUP BY d.treatment_id
) dagg
    ON dagg.treatment_id = t.treatment_id

/* ---------------- Benefits ---------------- */
LEFT JOIN (
    SELECT
        ttb.treatment_id,
        GROUP_CONCAT(DISTINCT tb.name ORDER BY tb.name SEPARATOR ',') AS benefits_en,
        GROUP_CONCAT(DISTINCT tb.swedish ORDER BY tb.name SEPARATOR ',') AS benefits_sv
    FROM tbl_treatment_benefits ttb
    JOIN tbl_benefits tb
        ON tb.benefit_id = ttb.benefit_id
       AND tb.is_deleted = 0
       AND tb.approval_status = 'APPROVED'
    GROUP BY ttb.treatment_id
) bagg
    ON bagg.treatment_id = t.treatment_id

WHERE t.is_deleted = 0
  AND t.approval_status = 'APPROVED'

        `;

        const queryParams = [];
        const whereConditions = [];

        // ---------- Filter: Recommended ----------
        if (filters.recommended === true && user_id) {
            const fallbackTreatmentIds = await getTreatmentIDsByUserID(user_id);
            console.log("fallbackTreatmentIds", fallbackTreatmentIds);
            if (!fallbackTreatmentIds?.length) return [];

            const placeholders = fallbackTreatmentIds.map(() => '?').join(',');
            whereConditions.push(`t.treatment_id IN (${placeholders})`);
            queryParams.push(...fallbackTreatmentIds);
        }

        // ---------- Filter: treatment_ids ----------
        if (Array.isArray(filters.treatment_ids) && filters.treatment_ids.length) {
            const placeholders = filters.treatment_ids.map(() => '?').join(',');
            whereConditions.push(`t.treatment_id IN (${placeholders})`);
            queryParams.push(...filters.treatment_ids);
        }

        // ---------- Append dynamic filters (FIXED: AND not WHERE) ----------
        if (whereConditions.length) {
            query += ' AND ' + whereConditions.join(' AND ');
        }

        // ---------- Execute Query ----------
        let results = await db.query(query, queryParams);

        // ---------- Parse & Deduplicate Concerns ----------
        results = results.map(row => {
            let concerns = [];

            if (Array.isArray(row.concerns)) {
                const seen = new Set();
                concerns = row.concerns.filter(c => {
                    if (!c?.concern_id) return false;
                    if (seen.has(c.concern_id)) return false;
                    seen.add(c.concern_id);
                    return true;
                });
            } else if (typeof row.concerns === 'string') {
                try {
                    const parsed = JSON.parse(row.concerns);
                    const seen = new Set();
                    concerns = parsed.filter(c => {
                        if (!c?.concern_id) return false;
                        if (seen.has(c.concern_id)) return false;
                        seen.add(c.concern_id);
                        return true;
                    });
                } catch {
                    concerns = [];
                }
            }

            return {
                ...row,
                concerns,
            };
        });

        // ---------- Apply Search Similarity (Embeddings) ----------
        if (filters.search?.trim()) {
            var normalized_search;
            if (filters.search.length <= 3) {
                console.log("Short query, returning default valid_medical");
                normalized_search = filters.search
            } else {
                console.log("Long query, translating to english");
                normalized_search = await translator(filters.search, 'en');
            }
            // 2️⃣ Compute top similar rows using embedding
            results = await getTreatmentsAIResult(results, normalized_search, 0.4, null, lang);

            // 3️⃣ Apply pagination
            results = paginateRows(results, filters.limit, filters.page);

            return results;

            // results = await getTopSimilarRows(results, normalized_search);
        } else {
            results = results.map(row => {
                delete row.embeddings;
                // delete row.swedish;
                // delete row.description_sv;
                // delete row.description_en;
                delete row.embeddings;
                delete row.name_embeddings;
                return row;
            });
        }

        results = results.map(row => ({
            ...row,
            benefits: lang === "sv" ? row.benefits_sv : row.benefits_en
        }));

        return applyLanguageOverwrite(results, lang) || results;

    } catch (error) {
        console.error("Database Error in getAllTreatmentsV2:", error.message);
        throw new Error("Failed to fetch treatments.");
    }
};


//changes by @krishn
export const getSubTreatmentsByTreatmentId = async (treatment_id, lang = 'en') => {
    try {
        const rows = await db.query(
            `SELECT 
                ttst.id,
                ttst.treatment_id,
                ttst.sub_treatment_id,
                tstm.name,
                tstm.swedish,
                tstm.approval_status,
                tstm.is_deleted
             FROM tbl_treatment_sub_treatments ttst
             JOIN tbl_sub_treatment_master tstm
                ON ttst.sub_treatment_id = tstm.sub_treatment_id
             WHERE ttst.treatment_id = '${treatment_id}'
               AND tstm.is_deleted = 0
               AND tstm.approval_status = 'APPROVED'`,
        );

        // ⛔ DO NOT CHANGE RESPONSE FORMAT
        return rows.map(r => ({
            ...r,
            name: lang === "sv" ? r.swedish : r.name
        }));

    } catch (error) {
        console.error("DB Error:", error.message);
        throw new Error("Failed to fetch sub treatments.");
    }
};

export const getTreatmentsByTreatmentIds = async (treatment_ids = [], lang, doctor_id = null) => {
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
    t.is_admin_created,
    t.created_by_zynq_user_id,
    t.approval_status,
    t.is_deleted,
    t.embeddings,
    t.name_embeddings,
    t.created_at,
            ANY_VALUE(c.name) AS concern_name,
            ANY_VALUE(c.swedish) AS concern_name_swedish,
            dt.price AS doctor_price,
            dt.sub_treatment_id,
            dt.sub_treatment_price,
            tstm.name AS sub_treatment_name,
            tstm.swedish AS sub_treatment_swedish,

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
        FROM tbl_treatments t
        LEFT JOIN tbl_treatment_concerns tc ON tc.treatment_id = t.treatment_id
        LEFT JOIN tbl_concerns c ON c.concern_id = tc.concern_id
        LEFT JOIN tbl_doctor_treatments dt ON t.treatment_id = dt.treatment_id
        LEFT JOIN tbl_treatment_sub_treatments ttst ON dt.sub_treatment_id = ttst.sub_treatment_id
        LEFT JOIN tbl_sub_treatment_master tstm ON ttst.sub_treatment_id = tstm.sub_treatment_id

        
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
        `;

        const whereClauses = [];
        const params = [];

        if (Array.isArray(treatment_ids) && treatment_ids.length > 0) {
            const placeholders = treatment_ids.map(() => '?').join(', ');
            whereClauses.push(`t.treatment_id IN (${placeholders})`);
            params.push(...treatment_ids);
        }

        if (doctor_id) {
            whereClauses.push(`dt.doctor_id = ?`);
            params.push(doctor_id);
        }

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(" AND ")}`;
        }

        query += ` GROUP BY t.treatment_id, dt.price,
            dt.sub_treatment_id,
            dt.sub_treatment_price,
            tstm.name,
            tstm.swedish`;

        const rawRows = await db.query(query, params);

        // Group results by treatment
        const treatmentMap = {};

        for (const row of rawRows) {
            const id = row.treatment_id;

            if (!treatmentMap[id]) {
                treatmentMap[id] = {
                    ...row,
                    min_price: row.doctor_price || 0,
                    max_price: row.doctor_price || 0,
                    sub_treatments: [],
                    sub_treatment_set: new Set() // <---- to prevent duplicates
                };
            }

            // Update min/max price
            if (row.doctor_price) {
                treatmentMap[id].min_price = Math.min(treatmentMap[id].min_price, row.doctor_price);
                treatmentMap[id].max_price = Math.max(treatmentMap[id].max_price, row.doctor_price);
            }

            // Add sub-treatment if exists & not duplicate
            if (row.sub_treatment_id && !treatmentMap[id].sub_treatment_set.has(row.sub_treatment_id)) {

                treatmentMap[id].sub_treatment_set.add(row.sub_treatment_id); // save unique ID

                treatmentMap[id].sub_treatments.push({
                    sub_treatment_id: row.sub_treatment_id,
                    name: lang === "swedish" ? row.sub_treatment_swedish : row.sub_treatment_name,
                    price: row.sub_treatment_price || 0
                });
            }
        }

        let results = Object.values(treatmentMap);

        // cleanup temp set and embeddings
        results = results.map(r => {
            delete r.embeddings;
            delete r.name_embeddings;
            delete r.sub_treatment_set;   // remove tracking Set
            return r;
        });

        return formatBenefitsUnified(results, lang);

    } catch (error) {
        console.error("Database Error in getTreatmentsByTreatmentIds:", error.message);
        throw new Error("Failed to fetch treatments.");
    }
};

export const getTreatmentsByTreatmentDoctorId = async (doctor_id, lang) => {
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

            WHERE 
                dt.doctor_id = ?
                AND t.is_deleted = 0
                AND t.approval_status = 'APPROVED'

                  GROUP BY dt.doctor_id,
                dt.treatment_id,
                dt.price,
                dt.sub_treatment_id,
                dt.sub_treatment_price

            ORDER BY t.name, st.name
        `;

        // SAFE QUERY
        let results = await db.query(query, [doctor_id]);

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

export const getTreatmentIdsByConcernIds = async (concern_ids = []) => {
    try {
        if (!Array.isArray(concern_ids) || concern_ids.length === 0) {
            return []; // Early return for empty input
        }

        const placeholders = concern_ids.map(() => '?').join(', ');
        const query = `
            SELECT DISTINCT treatment_id
            FROM tbl_treatment_concerns
            WHERE concern_id IN (${placeholders})
        `;

        const results = await db.query(query, concern_ids);
        return results.map(row => row.treatment_id).filter(Boolean);
    } catch (error) {
        console.error("Database Error in getTreatmentIdsByConcernIds:", error);
        throw new Error("Failed to fetch treatment IDs by concern IDs.");
    }
};


export const getLegalDocumentsForUsers = async (role, language) => {
    try {
        const rows = await db.query(
            `SELECT type, text FROM tbl_legal_documents`
        );

        const docs = Object.fromEntries(rows.map(({ type, text }) => [type, text]));

        if (role === "ADMIN") {
            return {
                TERMS_CONDITIONS: docs.TERMS_CONDITIONS ?? null,
                PRIVACY_POLICY: docs.PRIVACY_POLICY ?? null,
                TERMS_CONDITIONS_SV: docs.TERMS_CONDITIONS_SV ?? null,
                PRIVACY_POLICY_SV: docs.PRIVACY_POLICY_SV ?? null,
            };
        }

        const isSwedish = language === "sv";
        return {
            TERMS_CONDITIONS: docs[isSwedish ? "TERMS_CONDITIONS_SV" : "TERMS_CONDITIONS"] ?? null,
            PRIVACY_POLICY: docs[isSwedish ? "PRIVACY_POLICY_SV" : "PRIVACY_POLICY"] ?? null,
        };
    } catch (error) {
        console.error("❌ Database Error in getLegalDocumentsForUsers:", error);
        throw new Error("Failed to fetch legal documents");
    }
};

export const updateLegalDocumentsService = async ({
    TERMS_CONDITIONS,
    PRIVACY_POLICY,
    TERMS_CONDITIONS_SV,
    PRIVACY_POLICY_SV,
}) => {
    try {
        const cases = [];
        const values = [];
        const types = [];

        const addCase = (field, dbType) => {
            if (field !== undefined) {
                cases.push(`WHEN ? THEN ?`);
                values.push(dbType, field);
                types.push(dbType);
            }
        };

        addCase(TERMS_CONDITIONS, "TERMS_CONDITIONS");
        addCase(PRIVACY_POLICY, "PRIVACY_POLICY");
        addCase(TERMS_CONDITIONS_SV, "TERMS_CONDITIONS_SV");
        addCase(PRIVACY_POLICY_SV, "PRIVACY_POLICY_SV");

        if (cases.length === 0) return { affectedRows: 0 }; // nothing to update

        const placeholders = types.map(() => "?").join(", ");
        const sql = `
      UPDATE tbl_legal_documents
      SET text = CASE type
        ${cases.join("\n")}
      END
      WHERE type IN (${placeholders})
    `;

        // Order of params: for each WHEN => [type, value], then WHERE types
        const params = [...values, ...types];

        const result = await db.query(sql, params);
        return result;
    } catch (err) {
        console.error("❌ Database Error in updateLegalDocumentsService:", err);
        throw new Error("Failed to update legal documents");
    }
};

export const getTipsByConcernIds = async (concern_ids = [], lang = "en") => {
    if (!Array.isArray(concern_ids) || concern_ids.length === 0) {
        return [];
    }

    try {
        const placeholders = concern_ids.map(() => '?').join(', ');
        const query = `
            SELECT tips
            FROM tbl_concerns
            WHERE concern_id IN (${placeholders});
        `;

        const results = await db.query(query, concern_ids);

        const allTips = [];

        for (const row of results) {
            let parsedTips = {};
            try {
                parsedTips = typeof row.tips === 'string'
                    ? JSON.parse(row.tips)
                    : row.tips || {};
            } catch (err) {
                console.warn("Invalid tips JSON:", row.tips);
                continue;
            }

            const tipsString = parsedTips?.[lang] || "";
            const tipsArray = typeof tipsString === "string"
                ? tipsString.split(",").map(t => t.trim()).filter(Boolean)
                : [];

            allTips.push(...tipsArray);
        }

        return allTips;
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch tips by concern IDs.");
    }
};


export const getWishlistForUser = async (user_id) => {
    try {
        const result = await db.query(`
            SELECT p.* 
            FROM tbl_wishlist w
            LEFT JOIN tbl_products p ON w.product_id = p.product_id
            WHERE w.user_id = ?`,
            [user_id]);
        return result;
    } catch (error) {
        console.error("Database Error in getWishlistForUser:", error);
        throw new Error("Failed to fetch wishlist for user.");
    }
};

export const toggleWishlistProductForUser = async (product_id, user_id) => {
    try {
        const deleteResult = await db.query(
            `DELETE FROM tbl_wishlist WHERE product_id = ? AND user_id = ?`,
            [product_id, user_id]
        );

        if (deleteResult.affectedRows === 0) {
            await db.query(
                `INSERT INTO tbl_wishlist (product_id, user_id) VALUES (?, ?)`,
                [product_id, user_id]
            );
            return { action: 'added_to_wishlist' };
        } else {
            return { action: 'removed_from_wishlist' };
        }
    } catch (error) {
        console.error("Database Error in toggleWishlistProductForUser:", error);
        throw new Error("Failed to toggle wishlist product for user.");
    }
};

export const get_product_images_by_product_ids = async (productIds = []) => {
    if (!Array.isArray(productIds) || productIds.length === 0) return [];

    try {
        const placeholders = productIds.map(() => '?').join(', ');
        const query = `
            SELECT product_id, image
            FROM tbl_product_images
            WHERE product_id IN (${placeholders})
        `;

        return await db.query(query, productIds);
    } catch (error) {
        console.error("Database Error in get_product_images_by_product_ids:", error.message);
        throw new Error("Failed to fetch product images.");
    }
};

//======================================= Carts =========================================

export const addOrGetUserCart = async (clinic_id, user_id) => {
    try {
        let cartData;
        const result = await db.query(
            `SELECT cart_id FROM tbl_carts WHERE clinic_id = ? AND user_id = ? And cart_status = 'CART'`,
            [clinic_id, user_id]
        );

        if (result.length !== 0) {
            cartData = result;
        } else {
            await db.query(
                `INSERT INTO tbl_carts (clinic_id, user_id) VALUES (?, ?)`,
                [clinic_id, user_id]
            );

            cartData = await db.query(
                `SELECT cart_id FROM tbl_carts WHERE clinic_id = ? AND user_id = ? And cart_status = 'CART'`,
                [clinic_id, user_id]
            );
        }

        return cartData[0];
    } catch (error) {
        console.error("Database Error in addOrGetUserCart:", error);
        throw new Error("Failed to add or get user cart.");
    }
};

export const addProductToUserCart = async (cart_id, product_id, quantity) => {
    try {
        await db.query(
            `INSERT INTO tbl_cart_products (cart_id, product_id, quantity) VALUES (?, ?, ?)`,
            [cart_id, product_id, quantity]
        );
    } catch (error) {
        console.error("Database Error in addProductToUserCart:", error);
        throw new Error("Failed to add product to user cart.");
    }
}

export const deleteProductBeforeInsertData = async (cart_id, product_id, quantity) => {

    try {
        await db.query(
            `DELETE FROM tbl_cart_products WHERE cart_id = ? AND product_id = ?`,
            [cart_id, product_id]
        );

    } catch (error) {
        console.error("Database Error in deleteProductFromUserCart:", error);
        throw new Error("Failed to delete product from user cart.");
    }
}

export const deleteProductFromUserCart = async (user_id, product_id) => {
    try {
        await db.query(
            `DELETE cp FROM tbl_cart_products cp
             LEFT JOIN tbl_carts c ON cp.cart_id = c.cart_id
             WHERE c.user_id = ? AND cp.product_id = ? AND c.cart_status = 'CART'`,
            [user_id, product_id]
        );
    } catch (error) {
        console.error("Database Error in deleteProductFromUserCart:", error);
        throw new Error("Failed to delete product from user cart.");
    }
}

export const deleteCartByCartId = async (cart_id) => {
    try {
        await db.query(
            `
            DELETE cp, c FROM tbl_carts c
            LEFT JOIN tbl_cart_products cp ON cp.cart_id = c.cart_id
            WHERE c.cart_id = ? AND c.cart_status = 'CART'
            `,
            [cart_id]
        );
    } catch (error) {
        console.error("Database Error in deleteProductFromUserCart:", error);
        throw new Error("Failed to delete product from user cart.");
    }
}

export const getUserCarts = async (user_id) => {
    try {
        const result = await db.query(
            `SELECT ca.cart_id, cl.clinic_name, cl.address, cl.clinic_logo, ca.clinic_id, ca.user_id, cp.product_id, cp.quantity, p.name as product_name, p.price, p.short_description, p.stock
             FROM tbl_carts ca
             LEFT JOIN tbl_cart_products cp ON ca.cart_id = cp.cart_id
             LEFT JOIN tbl_products p ON cp.product_id = p.product_id
             LEFT JOIN tbl_clinics cl ON ca.clinic_id = cl.clinic_id
             WHERE ca.user_id = ? AND ca.cart_status = 'CART'
             ORDER BY ca.created_at DESC
             `,
            [user_id]
        );
        return result;
    } catch (error) {
        console.error("Database Error in getUserCarts:", error);
        throw new Error("Failed to get user carts.");
    }
}

export const getSingleCartByCartId = async (cart_id) => {
    try {
        const result = await db.query(
            `SELECT ca.cart_id, cl.clinic_name, cl.clinic_logo, ca.clinic_id, ca.user_id, cp.product_id, cp.quantity, p.name as product_name, p.price, p.short_description, p.stock
             FROM tbl_carts ca
             LEFT JOIN tbl_cart_products cp ON ca.cart_id = cp.cart_id
             LEFT JOIN tbl_products p ON cp.product_id = p.product_id
             LEFT JOIN tbl_clinics cl ON ca.clinic_id = cl.clinic_id
             WHERE ca.cart_id = ? AND ca.cart_status = 'CART'
             ORDER BY ca.created_at DESC
             `,
            [cart_id]
        );
        return result;
    } catch (error) {
        console.error("Database Error in getUserCarts:", error);
        throw new Error("Failed to get user carts.");
    }
}

export const getSingleCartByClinicId = async (clinic_id, user_id) => {
    try {
        const result = await db.query(
            `SELECT ca.cart_id, cl.clinic_name, cl.clinic_logo, ca.clinic_id, ca.user_id, cp.product_id, cp.quantity, p.name as product_name, p.price, p.short_description, p.stock
             FROM tbl_carts ca
             LEFT JOIN tbl_cart_products cp ON ca.cart_id = cp.cart_id
             LEFT JOIN tbl_products p ON cp.product_id = p.product_id
             LEFT JOIN tbl_clinics cl ON ca.clinic_id = cl.clinic_id
             WHERE ca.clinic_id = ? AND ca.user_id = ? AND ca.cart_status = 'CART'
             ORDER BY ca.created_at DESC
             `,
            [clinic_id, user_id]
        );
        return result;
    } catch (error) {
        console.error("Database Error in getUserCarts:", error);
        throw new Error("Failed to get user carts.");
    }
}

// -------------------------------------Updated Code Okay ------------------------------------------------//

export const getDoctorsByFirstNameSearchOnly = async ({ search = '', page = null, limit = null }) => {

    try {
        if (!search?.trim()) return [];

        // 1️⃣ Fetch doctors with embeddings + aggregated fields
        let results = await db.query(`
            SELECT 
                d.doctor_id,
                d.name,
                d.last_name,
                TIMESTAMPDIFF(
                    YEAR, 
                    MIN(de.start_date), 
                    MAX(IFNULL(de.end_date, CURDATE()))
                ) AS experience_years,
                d.specialization,
                ANY_VALUE(d.fee_per_session) AS fee_per_session,
                d.profile_image,

                dm.clinic_id,
                c.clinic_name,
                c.address AS clinic_address,

                ROUND(AVG(ar.rating), 2) AS avg_rating,

                d.embeddings,

                -- 🔥 NEW: Comma-separated treatments
                (
                    SELECT GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ', ')
                    FROM tbl_doctor_treatments dt
                    JOIN tbl_treatments t ON t.treatment_id = dt.treatment_id
                    WHERE dt.doctor_id = d.doctor_id AND dm.clinic_id = dt.clinic_id
                ) AS treatments,

                (
                    SELECT GROUP_CONCAT(tbd.name ORDER BY tbd.name SEPARATOR ', ')
                    FROM tbl_treatment_device_user_maps  tdum
                    JOIN tbl_treatment_devices  td ON 
                    tdum.device_id = td.id
                    LEFT JOIN tbl_devices tbd
                    ON tbd.device_id = td.device_id
                    AND tbd.is_deleted = 0
                    WHERE tdum.zynq_user_id = d.zynq_user_id AND tdum.clinic_id = c.clinic_id
                ) AS devices,

                (
                    SELECT GROUP_CONCAT(tbd.swedish ORDER BY tbd.swedish SEPARATOR ', ')
                    FROM tbl_treatment_device_user_maps  tdum
                    JOIN tbl_treatment_devices  td ON 
                    tdum.device_id = td.id
                    LEFT JOIN tbl_devices tbd
                    ON tbd.device_id = td.device_id
                    AND tbd.is_deleted = 0
                    WHERE tdum.zynq_user_id = d.zynq_user_id AND tdum.clinic_id = c.clinic_id
                ) AS devices_swedish,

                 (
                    SELECT GROUP_CONCAT(tst.English ORDER BY tst.English SEPARATOR ', ')
                    FROM tbl_doctor_skin_types dst
                    JOIN tbl_skin_types   tst ON 
                    dst.skin_type_id = tst.skin_type_id
                    WHERE 
                dst.doctor_id = d.doctor_id AND dst.clinic_id = c.clinic_id
                ) AS skin_types,

                (
                    SELECT GROUP_CONCAT(tst.Swedish ORDER BY tst.Swedish SEPARATOR ', ')
                    FROM tbl_doctor_skin_types dst
                    JOIN tbl_skin_types   tst ON 
                    dst.skin_type_id = tst.skin_type_id
                    WHERE 
                dst.doctor_id = d.doctor_id AND dst.clinic_id = c.clinic_id
                ) AS skin_types_swedish

                FROM tbl_doctors d

                LEFT JOIN tbl_doctor_clinic_map dm 
                    ON d.doctor_id = dm.doctor_id

                LEFT JOIN tbl_clinics c 
                    ON dm.clinic_id = c.clinic_id

                LEFT JOIN tbl_appointment_ratings ar 
                    ON d.doctor_id = ar.doctor_id 
                    AND ar.approval_status = 'APPROVED'

                LEFT JOIN tbl_doctor_experiences de 
                    ON d.doctor_id = de.doctor_id

                WHERE d.profile_status = 'VERIFIED'
                AND d.name IS NOT NULL

                GROUP BY 
                d.doctor_id, 
                dm.clinic_id

        `);

        // 2️⃣ Compute top similar rows using embeddings
        results = await getDoctorsAIResult(results, search, 0.3);
        // 3️⃣ Apply pagination
        results = paginateRows(results, limit, page);

        return results;
    } catch (error) {
        console.error('Database Error in getDoctorsByFirstNameSearchOnly:', error.message);
        throw new Error('Failed to fetch doctors.');
    }
};

export const getClinicsByNameSearchOnly = async ({ search = '', page = null, limit = null }) => {
    try {
        if (!search?.trim()) return [];

        let results = await db.query(`
            SELECT 
    c.*,

    MIN(CAST(d.fee_per_session AS DECIMAL(10,2))) AS doctor_lower_price_range,
    MAX(CAST(d.fee_per_session AS DECIMAL(10,2))) AS doctor_higher_price_range,
    ROUND(AVG(ar.rating), 2) AS avg_rating,

    -- 👇 devices array workaround
    COALESCE(
        CONCAT(
            '[',
            GROUP_CONCAT(DISTINCT JSON_QUOTE(td.device_name)),
            ']'
        ),
        '[]'
    ) AS devices

FROM tbl_clinics c

LEFT JOIN tbl_doctor_clinic_map dcm 
    ON c.clinic_id = dcm.clinic_id

LEFT JOIN tbl_doctors d 
    ON d.doctor_id = dcm.doctor_id

LEFT JOIN tbl_appointment_ratings ar 
    ON c.clinic_id = ar.clinic_id 
   AND ar.approval_status = 'APPROVED'

LEFT JOIN tbl_clinic_aesthetic_devices cad
    ON c.clinic_id = cad.clinic_id

LEFT JOIN tbl_treatment_devices td
    ON td.id = cad.aesthetic_devices_id

WHERE c.profile_status = 'VERIFIED'

GROUP BY c.clinic_id;

        `);

        // 2️⃣ REMOVE embeddings before AI filtering
        results = await Promise.all(
            results.map(async (row) => {
                delete row.embeddings;

                // safe devices parsing
                try {
                    row.devices = row.devices ? JSON.parse(row.devices) : [];
                } catch {
                    row.devices = [];
                }

                // get only treatments array (not whole object)
                const treatmentData = await getClinicMappedTreatments(row.clinic_id);
                row.treatments = treatmentData?.treatments ?? [];

                return row;
            })
        );


        // 3️⃣ Compute top similar rows using embedding stored in DB_sync table
        results = await getClinicsAIResult(results, search,);

        // 4️⃣ Apply pagination
        results = paginateRows(results, limit, page);

        return results;
    } catch (error) {
        console.error('Database Error in getClinicsByNameSearchOnly:', error.message);
        throw new Error('Failed to fetch clinics by name.');
    }
};


export const getProductsByNameSearchOnly = async ({ search = '', page = null, limit = null }) => {
    try {
        if (!search?.trim()) return [];

        // 1️⃣ Fetch all products that have embeddings
        let results = await db.query(`
      SELECT *
      FROM tbl_products
      WHERE is_hidden = 0 AND embeddings IS NOT NULL AND is_deleted = 0 AND approval_status = 'APPROVED' 
    `);

        // 2️⃣ Compute top similar rows using embedding
        results = await getTopSimilarRows(results, search);

        // 3️⃣ Apply pagination
        results = paginateRows(results, limit, page);

        return results;
    } catch (error) {
        console.error('Database Error in getProductsByNameSearchOnly:', error.message);
        throw new Error('Failed to fetch products by name.');
    }
};

export const getDevicesByNameSearchOnly = async ({ search = '', page = null, limit = null }) => {

    try {
        if (!search?.trim()) return [];
        const queryInfo = parseSearchIntent(search);

        // 1️⃣ Fetch mapped device entities
        let results = await db.query(`
        SELECT 
          d.id,
          dt.device_id,
          dt.name AS device_name,
          dt.swedish AS device_swedish,
          d.treatment_id,
          t.name as treatment_name,
          t.swedish as treatment_swedish,
          t.classification_type
        FROM tbl_treatment_devices d
        LEFT JOIN tbl_treatments t ON d.treatment_id = t.treatment_id
        LEFT JOIN tbl_devices dt ON d.device_id = dt.device_id
        WHERE t.approval_status = 'APPROVED'
          AND t.is_deleted = 0
          AND dt.approval_status = 'APPROVED'
          AND dt.is_deleted = 0
        GROUP BY d.id, d.treatment_id
      `);


        // 2️⃣ Candidate generation: hard type/category guard BEFORE semantic ranking
        const typedPre = enforceDeviceSectionCandidates(results, queryInfo, {
            phase: "candidate_generation",
            minRelationshipStrength: 0
        });
        results = typedPre.accepted;

        // 3️⃣ Semantic/lexical ranking only on typed-safe candidates
        results = await getDevicesAIResult(results, search);

        // 4️⃣ Section-assignment validation (strict)
        const typedFinal = enforceDeviceSectionCandidates(results, queryInfo, {
            phase: "section_assignment",
            minRelationshipStrength: queryInfo.canonicalIntent ? 0.66 : 0.62
        });
        results = typedFinal.accepted;

        // 5️⃣ Apply pagination
        results = paginateRows(results, limit, page);

        return results;
    } catch (error) {
        console.error('Database Error in getDoctorsByFirstNameSearchOnly:', error.message);
        throw new Error('Failed to fetch doctors.');
    }
};

export const getRelationshipAwareSearchExpansion = async ({
    search = '',
    language = 'en',
    seedDevices = [],
    seedTreatments = []
}) => {
    try {
        const queryInfo = parseSearchIntent(search || "");
        const normalized = normalizeSearchText(search || "").toLowerCase();
        if (!normalized) return { devices: [], treatments: [] };

        const like = `%${normalized}%`;

        const exactDeviceRows = await db.query(`
            SELECT DISTINCT
                td.id,
                d.device_id,
                td.treatment_id,
                d.name AS device_name,
                d.swedish AS device_swedish,
                t.name AS treatment_name,
                t.swedish AS treatment_swedish
            FROM tbl_devices d
            INNER JOIN tbl_treatment_devices td ON td.device_id = d.device_id
            INNER JOIN tbl_treatments t
                ON t.treatment_id = td.treatment_id
                AND t.is_deleted = 0
                AND t.approval_status = 'APPROVED'
            WHERE d.is_deleted = 0
              AND d.approval_status = 'APPROVED'
              AND (
                LOWER(d.name) = ?
                OR LOWER(d.swedish) = ?
                OR LOWER(d.name) LIKE ?
                OR LOWER(d.swedish) LIKE ?
                OR LOWER(IFNULL(td.device_name, '')) = ?
                OR LOWER(IFNULL(td.device_name, '')) LIKE ?
              )
        `, [normalized, normalized, like, like, normalized, like]);

        const exactTreatmentRows = await db.query(`
            SELECT DISTINCT t.treatment_id
            FROM tbl_treatments t
            LEFT JOIN tbl_treatment_like_wise_terms tlwt
                ON tlwt.treatment_id = t.treatment_id
            LEFT JOIN tbl_likewise_terms lwt
                ON lwt.like_wise_term_id = tlwt.like_wise_term_id
                AND lwt.is_deleted = 0
                AND lwt.approval_status = 'APPROVED'
            WHERE t.is_deleted = 0
              AND t.approval_status = 'APPROVED'
              AND (
                LOWER(t.name) = ?
                OR LOWER(t.swedish) = ?
                OR LOWER(t.name) LIKE ?
                OR LOWER(t.swedish) LIKE ?
                OR LOWER(IFNULL(lwt.name, '')) = ?
                OR LOWER(IFNULL(lwt.swedish, '')) = ?
                OR LOWER(IFNULL(lwt.name, '')) LIKE ?
                OR LOWER(IFNULL(lwt.swedish, '')) LIKE ?
              )
        `, [normalized, normalized, like, like, normalized, normalized, like, like]);

        const deviceSeedIds = new Set([
            ...seedDevices.map((d) => d?.device_id).filter(Boolean),
            ...exactDeviceRows.map((d) => d?.device_id).filter(Boolean)
        ]);

        const treatmentSeedIds = new Set([
            ...seedTreatments.map((t) => t?.treatment_id).filter(Boolean),
            ...seedDevices.map((d) => d?.treatment_id).filter(Boolean),
            ...exactDeviceRows.map((d) => d?.treatment_id).filter(Boolean),
            ...exactTreatmentRows.map((t) => t?.treatment_id).filter(Boolean)
        ]);

        let relatedTreatmentRows = [];
        if (deviceSeedIds.size > 0) {
            relatedTreatmentRows = await db.query(`
                SELECT DISTINCT td.treatment_id
                FROM tbl_treatment_devices td
                INNER JOIN tbl_treatments t
                    ON t.treatment_id = td.treatment_id
                    AND t.is_deleted = 0
                    AND t.approval_status = 'APPROVED'
                WHERE td.device_id IN (?)
            `, [Array.from(deviceSeedIds)]);
        }

        relatedTreatmentRows.forEach((row) => {
            if (row?.treatment_id) treatmentSeedIds.add(row.treatment_id);
        });

        let relatedDeviceRows = [];
        if (treatmentSeedIds.size > 0) {
            relatedDeviceRows = await db.query(`
                SELECT DISTINCT
                    td.id,
                    d.device_id,
                    td.treatment_id,
                    d.name AS device_name,
                    d.swedish AS device_swedish,
                    t.name AS treatment_name,
                    t.swedish AS treatment_swedish
                FROM tbl_treatment_devices td
                INNER JOIN tbl_devices d
                    ON d.device_id = td.device_id
                    AND d.is_deleted = 0
                    AND d.approval_status = 'APPROVED'
                INNER JOIN tbl_treatments t
                    ON t.treatment_id = td.treatment_id
                    AND t.is_deleted = 0
                    AND t.approval_status = 'APPROVED'
                WHERE td.treatment_id IN (?)
            `, [Array.from(treatmentSeedIds)]);
        }

        const finalTreatmentIds = Array.from(treatmentSeedIds);
        let treatmentDetails = [];
        if (finalTreatmentIds.length > 0) {
            treatmentDetails = await db.query(`
                SELECT 
                    t.treatment_id,
                    t.name,
                    t.swedish,
                    t.classification_type,
                    t.description_en,
                    t.description_sv,
                    GROUP_CONCAT(DISTINCT lwt.name ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms,
                    GROUP_CONCAT(DISTINCT lwt.swedish ORDER BY lwt.name SEPARATOR ',') AS like_wise_terms_swedish,
                    GROUP_CONCAT(DISTINCT tb.name ORDER BY tb.name SEPARATOR ',') AS benefits_en,
                    GROUP_CONCAT(DISTINCT tb.swedish ORDER BY tb.name SEPARATOR ',') AS benefits_sv,
                    GROUP_CONCAT(DISTINCT tbd.name ORDER BY tbd.name SEPARATOR ',') AS device_name,
                    GROUP_CONCAT(DISTINCT tbd.swedish ORDER BY tbd.name SEPARATOR ',') AS device_name_swedish
                FROM tbl_treatments t
                LEFT JOIN tbl_treatment_like_wise_terms tlwt
                    ON tlwt.treatment_id = t.treatment_id
                LEFT JOIN tbl_likewise_terms lwt
                    ON lwt.like_wise_term_id = tlwt.like_wise_term_id
                    AND lwt.is_deleted = 0
                    AND lwt.approval_status = 'APPROVED'
                LEFT JOIN tbl_treatment_benefits ttb
                    ON ttb.treatment_id = t.treatment_id
                LEFT JOIN tbl_benefits tb
                    ON tb.benefit_id = ttb.benefit_id
                    AND tb.is_deleted = 0
                    AND tb.approval_status = 'APPROVED'
                LEFT JOIN tbl_treatment_devices td
                    ON td.treatment_id = t.treatment_id
                LEFT JOIN tbl_devices tbd
                    ON tbd.device_id = td.device_id
                    AND tbd.is_deleted = 0
                    AND tbd.approval_status = 'APPROVED'
                WHERE t.is_deleted = 0
                  AND t.approval_status = 'APPROVED'
                  AND t.treatment_id IN (?)
                GROUP BY t.treatment_id
            `, [finalTreatmentIds]);
        }

        const exactTreatmentIdSet = new Set(exactTreatmentRows.map((r) => r.treatment_id));
        const exactDeviceMapIdSet = new Set(exactDeviceRows.map((r) => r.id));
        const exactDeviceIdSet = new Set(exactDeviceRows.map((r) => r.device_id));
        const directTreatmentIdSet = new Set(relatedTreatmentRows.map((r) => r.treatment_id));

        const treatmentRelationMap = new Map();
        treatmentDetails.forEach((row) => {
            if (exactTreatmentIdSet.has(row.treatment_id)) {
                treatmentRelationMap.set(row.treatment_id, { priority: 1, type: "exact_match" });
            } else if (directTreatmentIdSet.has(row.treatment_id)) {
                treatmentRelationMap.set(row.treatment_id, { priority: 2, type: "direct_relation" });
            } else {
                treatmentRelationMap.set(row.treatment_id, { priority: 3, type: "synonym_relation" });
            }
        });

        const subTreatments = finalTreatmentIds.length > 0
            ? await db.query(`
                SELECT
                    tts.treatment_id,
                    GROUP_CONCAT(DISTINCT stm.name ORDER BY stm.name SEPARATOR ',') AS sub_treatments_en,
                    GROUP_CONCAT(DISTINCT stm.swedish ORDER BY stm.name SEPARATOR ',') AS sub_treatments_sv
                FROM tbl_treatment_sub_treatments tts
                INNER JOIN tbl_sub_treatment_master stm
                    ON stm.sub_treatment_id = tts.sub_treatment_id
                    AND stm.is_deleted = 0
                    AND stm.approval_status = 'APPROVED'
                WHERE tts.treatment_id IN (?)
                GROUP BY tts.treatment_id
            `, [finalTreatmentIds])
            : [];

        const concerns = finalTreatmentIds.length > 0
            ? await db.query(`
                SELECT
                    tc.treatment_id,
                    GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ',') AS concerns_en,
                    GROUP_CONCAT(DISTINCT c.swedish ORDER BY c.name SEPARATOR ',') AS concerns_sv
                FROM tbl_treatment_concerns tc
                INNER JOIN tbl_concerns c
                    ON c.concern_id = tc.concern_id
                    AND c.is_deleted = 0
                    AND c.approval_status = 'APPROVED'
                WHERE tc.treatment_id IN (?)
                GROUP BY tc.treatment_id
            `, [finalTreatmentIds])
            : [];

        const subMap = new Map(subTreatments.map((r) => [r.treatment_id, r]));
        const concernMap = new Map(concerns.map((r) => [r.treatment_id, r]));

        const enrichedTreatments = treatmentDetails.map((row) => {
            const relation = treatmentRelationMap.get(row.treatment_id) || { priority: 3, type: "synonym_relation" };
            const sub = subMap.get(row.treatment_id);
            const concern = concernMap.get(row.treatment_id);

            return {
                ...row,
                name: restoreCanonicalBrandTerms(language === "en" ? row.name : row.swedish),
                description: language === "en" ? row.description_en : row.description_sv,
                benefits: language === "en" ? row.benefits_en : row.benefits_sv,
                device_name: restoreCanonicalBrandTerms(language === "en" ? row.device_name : (row.device_name_swedish || row.device_name)),
                like_wise_terms: restoreCanonicalBrandTerms(language === "en" ? row.like_wise_terms : (row.like_wise_terms_swedish || row.like_wise_terms)),
                linked_sub_treatments: language === "en"
                    ? (sub?.sub_treatments_en || "")
                    : (sub?.sub_treatments_sv || sub?.sub_treatments_en || ""),
                linked_concerns: language === "en"
                    ? (concern?.concerns_en || "")
                    : (concern?.concerns_sv || concern?.concerns_en || ""),
                relation_priority: relation.priority,
                relation_match_type: relation.type
            };
        });

        let enrichedDevices = relatedDeviceRows.map((row) => ({
            ...row,
            relation_priority: exactDeviceMapIdSet.has(row.id) ? 1 : 2,
            relation_match_type: exactDeviceMapIdSet.has(row.id) ? "exact_match" : "direct_relation",
            device_name: restoreCanonicalBrandTerms(language === "en" ? row.device_name : (row.device_swedish || row.device_name)),
            treatment_name: restoreCanonicalBrandTerms(language === "en" ? row.treatment_name : (row.treatment_swedish || row.treatment_name))
        }));

        if (exactDeviceIdSet.size > 0) {
            enrichedDevices = enrichedDevices.filter((row) => exactDeviceIdSet.has(row.device_id));
        }

        const typedDeviceGate = enforceDeviceSectionCandidates(enrichedDevices, queryInfo, {
            minRelationshipStrength: 0.68
        });
        enrichedDevices = typedDeviceGate.accepted;

        // ---- Doctor relation expansion via treatment mappings ----
        const relatedDoctorClinicRows = finalTreatmentIds.length > 0
            ? await db.query(`
                SELECT DISTINCT
                    dt.doctor_id,
                    dt.clinic_id
                FROM tbl_doctor_treatments dt
                INNER JOIN tbl_doctors d
                    ON d.doctor_id = dt.doctor_id
                    AND d.profile_status = 'VERIFIED'
                INNER JOIN tbl_clinics c
                    ON c.clinic_id = dt.clinic_id
                    AND c.profile_status = 'VERIFIED'
                WHERE dt.treatment_id IN (?)
            `, [finalTreatmentIds])
            : [];

        const doctorIds = Array.from(new Set(relatedDoctorClinicRows.map((r) => r.doctor_id).filter(Boolean)));
        const clinicIdsFromDoctorMap = Array.from(new Set(relatedDoctorClinicRows.map((r) => r.clinic_id).filter(Boolean)));

        const relatedDoctors = doctorIds.length > 0
            ? await db.query(`
                SELECT
                    d.doctor_id,
                    d.name,
                    d.last_name,
                    d.specialization,
                    d.profile_image,
                    d.fee_per_session,
                    dm.clinic_id,
                    c.clinic_name,
                    c.address AS clinic_address,
                    ROUND(AVG(ar.rating), 2) AS avg_rating
                FROM tbl_doctors d
                INNER JOIN tbl_doctor_clinic_map dm
                    ON dm.doctor_id = d.doctor_id
                INNER JOIN tbl_clinics c
                    ON c.clinic_id = dm.clinic_id
                    AND c.profile_status = 'VERIFIED'
                LEFT JOIN tbl_appointment_ratings ar
                    ON ar.doctor_id = d.doctor_id
                    AND ar.approval_status = 'APPROVED'
                WHERE d.profile_status = 'VERIFIED'
                  AND d.doctor_id IN (?)
                GROUP BY d.doctor_id, dm.clinic_id
            `, [doctorIds])
            : [];

        const enrichedDoctors = relatedDoctors.map((row) => ({
            ...row,
            relation_priority: 2,
            relation_match_type: "direct_relation",
            score: 0
        }));

        // ---- Clinic relation expansion via treatment/device mappings ----
        const deviceSeedIdList = Array.from(deviceSeedIds);
        const clinicIdsFromDeviceMap = deviceSeedIdList.length > 0
            ? await db.query(`
                SELECT DISTINCT cad.clinic_id
                FROM tbl_clinic_aesthetic_devices cad
                INNER JOIN tbl_treatment_devices td
                    ON td.id = cad.aesthetic_devices_id
                INNER JOIN tbl_clinics c
                    ON c.clinic_id = cad.clinic_id
                    AND c.profile_status = 'VERIFIED'
                WHERE td.device_id IN (?)
            `, [deviceSeedIdList])
            : [];

        const clinicIds = Array.from(new Set([
            ...clinicIdsFromDoctorMap,
            ...clinicIdsFromDeviceMap.map((r) => r.clinic_id).filter(Boolean)
        ]));

        const relatedClinics = clinicIds.length > 0
            ? await db.query(`
                SELECT
                    c.clinic_id,
                    c.clinic_name,
                    c.address,
                    c.clinic_logo,
                    c.clinic_description,
                    ROUND(AVG(ar.rating), 2) AS avg_rating
                FROM tbl_clinics c
                LEFT JOIN tbl_appointment_ratings ar
                    ON ar.clinic_id = c.clinic_id
                    AND ar.approval_status = 'APPROVED'
                WHERE c.profile_status = 'VERIFIED'
                  AND c.clinic_id IN (?)
                GROUP BY c.clinic_id
            `, [clinicIds])
            : [];

        const enrichedClinics = relatedClinics.map((row) => ({
            ...row,
            relation_priority: 2,
            relation_match_type: "direct_relation",
            score: 0
        }));

        return {
            devices: enrichedDevices,
            treatments: enrichedTreatments,
            doctors: enrichedDoctors,
            clinics: enrichedClinics,
            debug: {
                device_rejections: typedDeviceGate.rejected
            }
        };
    } catch (error) {
        console.error("Database Error in getRelationshipAwareSearchExpansion:", error.message);
        return { devices: [], treatments: [] };
    }
};


export const getTreatmentsBySearchOnly = async ({
    search = '',
    language = 'en',
    page = null,
    limit = null,
    actualSearch,
    debug = false
}) => {
    try {
        if (!search?.trim()) return [];
        const queryInfo = parseSearchIntent(actualSearch || search);

        // 1️⃣ Fetch all treatments that have embeddings
        let results = await db.query(`
      SELECT t.treatment_id,
      t.name,t.swedish,
      t.classification_type,
      t.description_en,
      t.description_sv ,
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
        DISTINCT tb.name
        ORDER BY tb.name
        SEPARATOR ','
    ) AS benefits_en,
   
      GROUP_CONCAT(
        DISTINCT tb.swedish
        ORDER BY tb.name
        SEPARATOR ','
    ) AS benefits_sv,

        GROUP_CONCAT(
        DISTINCT tbd.name
        ORDER BY tbd.name
        SEPARATOR ','
    ) AS device_name,
   
    GROUP_CONCAT(
        DISTINCT tbd.swedish
        ORDER BY tbd.name
        SEPARATOR ','
    ) AS device_name_swedish

      FROM tbl_treatments t
      
      LEFT JOIN tbl_treatment_like_wise_terms tlwt
    ON tlwt.treatment_id = t.treatment_id
   LEFT JOIN tbl_likewise_terms lwt
    ON lwt.like_wise_term_id = tlwt.like_wise_term_id
   AND lwt.is_deleted = 0
   AND lwt.approval_status = 'APPROVED'

      LEFT JOIN tbl_treatment_benefits ttb
    ON ttb.treatment_id = t.treatment_id
   LEFT JOIN tbl_benefits tb
    ON tb.benefit_id = ttb.benefit_id
    AND tb.is_deleted = 0
   AND tb.approval_status = 'APPROVED'

      LEFT JOIN tbl_treatment_devices d
    ON d.treatment_id = t.treatment_id
   LEFT JOIN tbl_devices tbd
    ON tbd.device_id = d.device_id
    AND tbd.is_deleted = 0
   AND tbd.approval_status = 'APPROVED'


      WHERE t.is_deleted = 0 AND t.approval_status = 'APPROVED'

      GROUP BY t.treatment_id
      ORDER BY t.treatment_id
    `);


        // 2️⃣ Stage A/C: lexical + strong semantic ranking inside intent guard
        const primaryResults = await getTreatmentsAIResult(
            results,
            search,
            0.4,
            null,
            language,
            { debug }
        );

        // 3️⃣ Stage B: structured relationship expansion
        const relationExpansion = await getRelationshipAwareSearchExpansion({
            search,
            language,
            seedTreatments: primaryResults,
            seedDevices: []
        });

        const relationGuarded = (relationExpansion?.treatments || []).filter((row) => {
            const text = normalizeSearchText([
                row.name,
                row.swedish,
                row.classification_type,
                row.description_en,
                row.description_sv,
                row.like_wise_terms,
                row.like_wise_terms_swedish,
                row.device_name,
                row.device_name_swedish
            ].filter(Boolean).join(" "));
            const intentAllowed = isTextAllowedForIntent(text, queryInfo);
            if (!intentAllowed) return false;
            if (queryInfo.canonicalIntent) {
                return Number(row?.relation_priority || 99) <= 2;
            }
            return true;
        });

        // 4️⃣ Merge by strict priority: exact/primary > direct relation
        results = mergeGraphAwareResults(primaryResults, relationGuarded, {
            keySelector: (row) => row?.treatment_id,
            nameSelector: (row) => row?.name || row?.swedish || "",
            scoreSelector: (row) => row?.score ?? row?.final_score ?? row?.lexical_score ?? 0,
            primaryPriority: 1,
            relatedDefaultPriority: 2
        });

        // 5️⃣ Stage D fallback gate: keep weak fallback only when primary set is sparse
        const primaryCount = primaryResults.filter((r) => !r?.is_fallback).length;
        if (queryInfo.canonicalIntent && primaryCount > 0) {
            results = results.filter((r) => !r?.is_fallback);
        } else if (primaryCount >= 4) {
            results = results.filter((r) => !r?.is_fallback);
        }

        // 6️⃣ Apply pagination
        results = paginateRows(results, limit, page);

        if (debug) {
            return {
                items: results,
                debug: {
                    query: {
                        raw: actualSearch || search,
                        normalized: queryInfo.normalized,
                        intent_bucket: queryInfo.intentBucket,
                        intent_type: queryInfo.intentType,
                        intent_confidence: queryInfo.intentConfidence,
                        negation: queryInfo.hasNegation
                    },
                    stages: {
                        stage_a_c_primary: primaryResults.length,
                        stage_b_structured: relationGuarded.length,
                        stage_d_fallback_enabled: !queryInfo.canonicalIntent && primaryCount < 4
                    }
                }
            };
        }

        return results;
    } catch (error) {
        console.error('Database Error in getTreatmentsBySearch:', error.message);
        throw new Error('Failed to fetch treatments.');
    }
};

export const getSubTreatmentsBySearchOnly = async ({
    search = '',
    language = 'en',
    page = null,
    limit = null,
    actualSearch
}) => {
    try {
        if (!search?.trim()) return [];

        // 1️⃣ Fetch all treatments that have embeddings
        let results = await db.query(`
            SELECT
                stm.sub_treatment_id,
                tstm.treatment_id,
                stm.name,
                stm.swedish,
                t.name AS treatment_name,
                t.swedish AS treatment_swedish
            FROM tbl_sub_treatment_master stm
            LEFT JOIN tbl_treatment_sub_treatments tstm 
                ON stm.sub_treatment_id = tstm.sub_treatment_id
            LEFT JOIN tbl_treatments t
                ON tstm.treatment_id = t.treatment_id
            WHERE stm.is_deleted = 0
            AND stm.approval_status = 'APPROVED'
            AND t.approval_status = 'APPROVED'
            AND t.is_deleted = 0
        `);

        // 2️⃣ Compute top similar rows using embedding
        results = await getSubTreatmentsAIResult(results, search, 0.4, null, language, actualSearch);

        // 3️⃣ Apply pagination
        results = paginateRows(results, limit, page);

        return results;
    } catch (error) {
        console.error('Database Error in getTreatmentsBySearch:', error.message);
        throw new Error('Failed to fetch treatments.');
    }
};

export const getSubTreatmentsByTreatmentIds = async ({
    treatmentIds = [],
    language = 'en',
    limit = null,
    page = null
}) => {
    try {
        const ids = Array.isArray(treatmentIds) ? treatmentIds.filter(Boolean) : [];
        if (!ids.length) return [];

        let rows = await db.query(`
            SELECT
                stm.sub_treatment_id,
                tts.treatment_id,
                stm.name,
                stm.swedish,
                t.name AS treatment_name,
                t.swedish AS treatment_swedish
            FROM tbl_treatment_sub_treatments tts
            INNER JOIN tbl_sub_treatment_master stm
                ON stm.sub_treatment_id = tts.sub_treatment_id
                AND stm.is_deleted = 0
                AND stm.approval_status = 'APPROVED'
            INNER JOIN tbl_treatments t
                ON t.treatment_id = tts.treatment_id
                AND t.is_deleted = 0
                AND t.approval_status = 'APPROVED'
            WHERE tts.treatment_id IN (?)
        `, [ids]);

        rows = rows.map((r) => ({
            ...r,
            name: language === "en" ? r.name : r.swedish,
            treatment_name: language === "en" ? r.treatment_name : r.treatment_swedish,
            relation_priority: 2,
            relation_match_type: "direct_relation"
        }));

        rows = paginateRows(rows, limit, page);
        return rows;
    } catch (error) {
        console.error("Database Error in getSubTreatmentsByTreatmentIds:", error.message);
        return [];
    }
};

const APP_URL = process.env.APP_URL;

export const getUserPurchasedProductModel = async (user_id) => {
    try {
        // 1️⃣ Fetch purchases + address in one go
        const purchaseRows = await db.query(
            `
            SELECT 
                pp.purchase_id,
                pp.cart_id,
                pp.product_details, 
                pp.total_price,
                pp.subtotal,
                pp.vat_amount,
                pp.created_at AS purchase_date,
                pp.shipment_status,
                pp.shipped_date,
                pp.delivered_date,
                a.address,
                a.name AS address_name,
                a.email AS address_email,
                a.city AS address_city,
                a.state AS address_state,
                a.zip_code AS address_zip_code,
                a.phone_number AS address_phone_number
            FROM tbl_product_purchase pp
            LEFT JOIN tbl_address a ON pp.address_id = a.address_id
            WHERE pp.user_id = ?
            ORDER BY pp.created_at DESC
            `,
            [user_id]
        );

        if (!purchaseRows.length) return [];

        // 2️⃣ Gather all unique product IDs (flattened)
        const allProductIds = [
            ...new Set(
                purchaseRows.flatMap(row =>
                    Array.isArray(row.product_details)
                        ? row.product_details.map(p => p.product_id)
                        : []
                )
            ),
        ];

        // 3️⃣ Fetch product info & clinics in one query using JOIN
        let productInfoMap = {};
        let clinicMap = {};

        if (allProductIds.length) {
            const productRows = await db.query(
                `
                SELECT 
                    p.product_id, p.stock, p.clinic_id,
                    c.clinic_name, c.address AS clinic_address, c.clinic_logo
                FROM tbl_products p
                LEFT JOIN tbl_clinics c ON p.clinic_id = c.clinic_id
                WHERE p.product_id IN (?)
                `,
                [allProductIds]
            );

            for (const row of productRows) {
                productInfoMap[row.product_id] = {
                    product_id: row.product_id,
                    stock: row.stock,
                    clinic_id: row.clinic_id,
                };
                clinicMap[row.clinic_id] = {
                    clinic_id: row.clinic_id,
                    clinic_name: row.clinic_name,
                    address: row.clinic_address,
                    clinic_logo: row.clinic_logo,
                };
            }
        }

        // 4️⃣ Fetch all product images in one go
        let imagesMap = {};
        if (allProductIds.length) {
            const imageRows = await get_product_images_by_product_ids(allProductIds);
            for (const row of imageRows) {
                if (!imagesMap[row.product_id]) imagesMap[row.product_id] = [];
                imagesMap[row.product_id].push(
                    row.image.startsWith("http")
                        ? row.image
                        : `${APP_URL}clinic/product_image/${row.image}`
                );
            }
        }

        // 5️⃣ Build final purchases
        return purchaseRows.map(row => {
            const products = Array.isArray(row.product_details) ? row.product_details : [];

            const enrichedProducts = products.map(p => {
                const prodInfo = productInfoMap[p.product_id] || {};
                return {
                    ...p,
                    stock: prodInfo.stock ?? 0,
                    clinic_id: prodInfo.clinic_id ?? null,
                    product_images: imagesMap[p.product_id] || [],
                };
            });

            const clinic_id = enrichedProducts.length ? enrichedProducts[0].clinic_id : null;

            return {
                purchase_id: row.purchase_id,
                purchase_type: "PRODUCT",
                cart_id: row.cart_id,
                purchase_date: row.purchase_date,
                total_price: row.total_price,
                subtotal: row.subtotal,
                vat_amount: row.vat_amount,
                address: {
                    address: row.address || null,
                    address_name: row.address_name || null,
                    address_email: row.address_email || null,
                    address_city: row.address_city || null,
                    address_state: row.address_state || null,
                    address_zip_code: row.address_zip_code || null,
                    address_phone_number: row.address_phone_number || null,
                },
                shipment_status: row.shipment_status,
                shipped_date: row.shipped_date || null,
                delivered_date: row.delivered_date || null,
                clinic: clinic_id ? clinicMap[clinic_id] || null : null,
                products: enrichedProducts,
            };
        });

    } catch (error) {
        console.error("Failed to fetch user purchased product data with clinic and images:", error);
        throw error;
    }
};


export const getUserCartProductModel = async (user_id) => {
    try {
        const query = `
      SELECT pp.* FROM tbl_product_purchase pp JOIN tbl_carts c ON pp.cart_id = c.cart_id WHERE pp.user_id = ? ORDER BY created_at DESC
    `;
        const results = await db.query(query, [user_id]);
        return results;
    } catch (error) {
        console.error("Failed to fetch purchase products data:", error);
        throw error;
    }
};

export const getSingleUserPurchasedProductModel = async (user_id, purchase_id) => {
    try {
        const query = `
      SELECT 
        pp.purchase_id,
        pp.cart_id,
        pp.product_details, 
        pp.total_price,
        pp.subtotal,
        pp.vat_amount,
        pp.created_at AS purchase_date,
        pp.shipment_status,
        pp.shipped_date,
        pp.delivered_date,
        a.address,
        a.name AS address_name,
        a.email AS address_email,
        a.city AS address_city,
        a.state AS address_state,
        a.zip_code AS address_zip_code,
        a.phone_number AS address_phone_number
      FROM tbl_product_purchase pp
      LEFT JOIN tbl_address a ON pp.address_id = a.address_id
      WHERE pp.user_id = ? AND pp.purchase_id = ?
      ORDER BY pp.created_at DESC
    `;
        const purchaseRows = await db.query(query, [user_id, purchase_id]);

        // 1️⃣ Gather all product IDs
        let allProductIds = [];
        for (const row of purchaseRows) {
            const products = Array.isArray(row.product_details) ? row.product_details : [];
            allProductIds.push(...products.map(p => p.product_id));
        }
        allProductIds = [...new Set(allProductIds)];

        // 2️⃣ Fetch product info (stock, clinic_id)
        let productInfoMap = {};
        if (allProductIds.length) {
            const productRows = await db.query(
                `SELECT product_id, stock, clinic_id FROM tbl_products WHERE product_id IN (?)`,
                [allProductIds]
            );
            productInfoMap = productRows.reduce((map, p) => {
                map[p.product_id] = p;
                return map;
            }, {});
        }

        // 3️⃣ Gather clinic IDs and fetch clinic data
        const allClinicIds = [...new Set(Object.values(productInfoMap).map(p => p.clinic_id))];
        let clinicMap = {};
        if (allClinicIds.length) {
            const clinicRows = await db.query(
                `SELECT clinic_id, clinic_name, address, clinic_logo FROM tbl_clinics WHERE clinic_id IN (?)`,
                [allClinicIds]
            );
            clinicMap = clinicRows.reduce((map, c) => {
                map[c.clinic_id] = c;
                return map;
            }, {});
        }

        // 4️⃣ Fetch product images
        let imagesMap = {};
        if (allProductIds.length) {
            const imageRows = await get_product_images_by_product_ids(allProductIds);
            imagesMap = imageRows.reduce((map, row) => {
                if (!map[row.product_id]) map[row.product_id] = [];
                map[row.product_id].push(
                    row.image.startsWith("http")
                        ? row.image
                        : `${APP_URL}clinic/product_image/${row.image}`
                );
                return map;
            }, {});
        }

        // 5️⃣ Build enriched purchase list
        const purchases = {};
        for (const row of purchaseRows) {
            const products = Array.isArray(row.product_details) ? row.product_details : [];

            const enrichedProducts = products.map(p => {
                const prodInfo = productInfoMap[p.product_id] || {};
                return {
                    ...p,
                    stock: prodInfo.stock ?? 0,
                    clinic_id: prodInfo.clinic_id ?? null,
                    product_images: imagesMap[p.product_id] || [],
                };
            });

            const clinic_id = enrichedProducts.length ? enrichedProducts[0].clinic_id : null;
            const clinic = clinicMap[clinic_id] || null;

            purchases[row.purchase_id] = {
                purchase_id: row.purchase_id,
                purchase_type: "PRODUCT",
                cart_id: row.cart_id,
                purchase_date: row.purchase_date,
                total_price: row.total_price,
                subtotal: row.subtotal,
                vat_amount: row.vat_amount,
                address: {
                    address_name: row.address_name || null,
                    address_email: row.address_email || null,
                    address_city: row.address_city || null,
                    address_state: row.address_state || null,
                    address_zip_code: row.address_zip_code || null,
                    address_phone_number: row.address_phone_number || null,
                },
                shipment_status: row.shipment_status,
                shipped_date: row.shipped_date || null,
                delivered_date: row.delivered_date || null,
                clinic,
                products: enrichedProducts,
            };
        }

        return Object.values(purchases);

    } catch (error) {
        console.error("Failed to fetch user purchased product data with clinic and images:", error);
        throw error;
    }
};

export const getSingleUserCartProductModel = async (user_id, purchase_id) => {
    try {
        const query = `
      SELECT pp.* 
      FROM tbl_product_purchase pp 
      JOIN tbl_carts c ON pp.cart_id = c.cart_id 
      WHERE pp.user_id = ?  AND pp.purchase_id = ?
      ORDER BY created_at DESC
    `;
        const results = await db.query(query, [user_id, purchase_id]);
        return results;
    } catch (error) {
        console.error("Failed to fetch purchase products data:", error);
        throw error;
    }
};

export const getSinglePurchasedProductsModel = async (purchase_id) => {
    try {
        const query = `
      SELECT pp.* 
      FROM tbl_product_purchase pp 
      WHERE pp.purchase_id = ?
      ORDER BY created_at DESC
    `;
        return await db.query(query, [purchase_id]);
    } catch (error) {
        console.error("Failed to fetch purchase products data:", error);
        throw error;
    }
}

export const checkProductStock = async (product_id, quantity) => {
    try {
        const query = `SELECT stock FROM tbl_products WHERE product_id = ?`;
        const result = await db.query(query, [product_id]);
        const stock = result[0]?.stock || 0;
        return stock >= quantity;
    } catch (error) {
        console.error("Failed to fetch product stock:", error);
        throw error;
    }
};

export const get_user_by_email = async (email, user_id) => {
    try {
        return await db.query(
            `SELECT * FROM tbl_users WHERE email = ? AND user_id != ?`,
            [email, user_id]
        );

    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to fetch user data.");
    }
};

export const delete_my_account = async (user_id) => {
    try {
        return await db.query(
            `UPDATE tbl_users SET
             is_deleted = 1,
             email = NULL,
             mobile_number = NULL
            WHERE user_id = ?`,
            [user_id]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to delete user.");
    }
};

export const guestLoginModel = async (data) => {
    try {
        await db.query(
            `INSERT IGNORE INTO tbl_guests (device_id, data) VALUES (?, ?)`,
            [data.device_id, data.data || null]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to save guest.");
    }
};

export const getGuestFaceScan = async (device_id) => {
    try {
        return await db.query(
            `SELECT * FROM tbl_guests WHERE device_id = ?`,
            [device_id]
        );
    } catch (error) {
        console.error("Database Error:", error.message);
        throw new Error("Failed to get guest.");
    }
};

export const updateDoctorClinicClaimedProfile = async (user_id, role_id) => {
    try {
        const DOCTOR_ROLE_ID = "3677a3e6-3196-11f0-9e07-0e8e5d906eef";
        const SOLO_DOCTOR_ROLE_ID = "407595e3-3196-11f0-9e07-0e8e5d906eef";

        const updates = [];

        if (role_id === DOCTOR_ROLE_ID || role_id === SOLO_DOCTOR_ROLE_ID) {
            updates.push(
                db.query(
                    "UPDATE `tbl_doctors` SET `profile_status` = 'CLAIMED' WHERE `zynq_user_id` = ?",
                    [user_id]
                )
            );
        }

        // Solo doctor also has a linked clinic
        if (role_id !== DOCTOR_ROLE_ID) {
            updates.push(
                db.query(
                    "UPDATE `tbl_clinics` SET `profile_status` = 'CLAIMED' WHERE `zynq_user_id` = ?",
                    [user_id]
                )
            );
        }

        await Promise.all(updates);
        return { success: true };
    } catch (error) {
        console.error("Error updating claimed profile:", error);
        throw error;
    }
};


export const getInvitedZynqUsers = async () => {
    try {
        const [clinics, doctors] = await Promise.all([
            db.query(`
                SELECT 'CLINIC' AS role, zu.email, c.clinic_id AS id, c.clinic_name AS name,
                c.invited_date, c.invitation_email_count, zu.language
                FROM tbl_clinics c
                LEFT JOIN tbl_zqnq_users zu ON c.zynq_user_id = zu.id
                WHERE c.profile_status = 'INVITED'
            `),
            db.query(`
                SELECT 'DOCTOR' AS role, zu.email, d.doctor_id AS id, d.name,
                d.invited_date, d.invitation_email_count, zu.language
                FROM tbl_doctors d
                LEFT JOIN tbl_zqnq_users zu ON d.zynq_user_id = zu.id
                WHERE d.profile_status = 'INVITED'
            `)
        ]);

        return [...clinics, ...doctors];
    } catch (error) {
        console.error("Database Error (getInvitedZynqUsers):", error.message);
        throw new Error("Failed to fetch invited zynq users.");
    }
};

export const deleteGuestDataModel = async () => {
    try {
        return await db.query(`
            DELETE FROM tbl_face_scan_results 
            WHERE 
            device_id IS NOT NULL AND 
            user_id IS NULL AND 
            created_at < NOW() - INTERVAL 1 DAY`);
    } catch (error) {
        console.error("Database Error (deleteGuestDataModel):", error.message);
        throw new Error("Failed to delete guest data.");
    }
}

export const updateGuestDeviceFaceScanModel = async (user_id, device_id) => {
    try {
        const [existingFaceScan] = await db.query(
            `SELECT * FROM tbl_face_scan_results WHERE device_id = ? LIMIT 1`,
            [device_id]
        );

        if (existingFaceScan && existingFaceScan.user_id) {
            // Clone existing record but assign new user_id
            const { face_scan_result_id, user_id: oldUserId, ...rest } = existingFaceScan;

            const fields = Object.keys(rest).concat("user_id");
            const placeholders = fields.map(() => "?").join(", ");
            const params = Object.values(rest).concat(user_id); // ✅ use the NEW user_id here

            const insertQuery = `
                INSERT INTO tbl_face_scan_results (${fields.join(", ")})
                VALUES (${placeholders})
            `;

            await db.query(insertQuery, params);
        }

        // Update guest record if exists
        await db.query(
            `
            UPDATE tbl_face_scan_results 
            SET user_id = ? 
            WHERE device_id = ? AND user_id IS NULL
            `,
            [user_id, device_id]
        );

        return { message: "Face scan updated successfully." };
    } catch (error) {
        console.error("Database Error (updateGuestDeviceFaceScanModel):", error.message);
        throw new Error("Failed to update or duplicate guest device face scan.");
    }
};

export const getTreatmentsByAppointmentId = async (appointment_id, language = 'en') => {
    try {
        const nameCol = language === 'sv' ? 'tt.swedish' : 'tt.name';
        const subNameCol = language === 'sv' ? 'st.swedish' : 'st.name';

        const result = await db.query(`
            SELECT 
    a.appointment_id,
    a.discount_type,
    a.discount_value,
    
    tat.treatment_id,
    ${nameCol} AS treatment_name,
    tat.price AS treatment_price,

    tat.sub_treatment_id,
    ${subNameCol} AS sub_treatment_name,
    tat.sub_treatment_price

FROM tbl_appointment_treatments tat

LEFT JOIN tbl_treatments tt 
    ON tt.treatment_id = tat.treatment_id

LEFT JOIN tbl_sub_treatment_master st 
    ON st.sub_treatment_id = tat.sub_treatment_id

LEFT JOIN tbl_appointments a
    ON a.appointment_id = tat.appointment_id

WHERE tat.appointment_id = ?
ORDER BY tat.treatment_id

        `, [appointment_id]);

        // Ensure rows is always an array
        const rows = Array.isArray(result) ? result : [];

        if (!rows || rows.length === 0) {
            return {
                appointment_id,
                discount_type: null,
                discount_value: null,
                treatments: [],
                total_price: 0,
                discount_amount: 0,
                total_price_with_discount: 0
            };
        }

        // ==============================
        // Group treatments
        // ==============================
        const treatmentMap = new Map();

        for (const r of rows) {
            if (!treatmentMap.has(r.treatment_id)) {
                treatmentMap.set(r.treatment_id, {
                    treatment_id: r.treatment_id,
                    name: r.treatment_name,
                    price: Number(r.treatment_price) || 0,
                    sub_treatments: []
                });
            }

            if (r.sub_treatment_id) {
                treatmentMap.get(r.treatment_id).sub_treatments.push({
                    sub_treatment_id: r.sub_treatment_id,
                    name: r.sub_treatment_name,
                    price: Number(r.sub_treatment_price) || 0
                });
            }
        }

        const treatments = [...treatmentMap.values()];

        // ==============================
        // Pricing Logic
        // ==============================
        let total_price = 0;

        treatments.forEach(t => {
            total_price += t.price;
            // t.sub_treatments.forEach(st => {
            //     total_price += st.price;
            // });
        });

        const discount_type = rows[0].discount_type;
        const discount_value = Number(rows[0].discount_value || 0);

        const discount_amount = Number(
            (
                discount_type === 'PERCENTAGE'
                    ? total_price * (discount_value / 100)
                    : discount_type === 'SEK'
                        ? discount_value
                        : 0
            ).toFixed(2)
        );

        const total_price_with_discount = Number((total_price - discount_amount).toFixed(2));

        return {
            appointment_id,
            discount_type,
            discount_value,
            treatments,
            total_price: Number(total_price.toFixed(2)),
            discount_amount,
            total_price_with_discount
        };

    } catch (error) {
        console.error("Database Error (getTreatmentsByAppointmentId):", error.message);
        throw new Error("Failed to fetch treatments for appointment.");
    }
};


export const addConsentModel = async ({ user_id = null, device_id = null }) => {
    try {
        return await db.query(`
            INSERT INTO tbl_consents (user_id, device_id)
            VALUES (?, ?)
        `, [user_id, device_id]);
    } catch (error) {
        console.error("Database Error (addConsentModel):", error.message);
        throw new Error("Failed to add consent.");
    }
}

export const getProductWithTreatmentsById = async (product_id) => {
    try {
        if (!product_id) throw new Error("Product ID is required");

        return await db.query(`
      SELECT 
        p.product_id,
        CONCAT(
          'Product Name: ', IFNULL(p.name,''),
          ', Price: ', IFNULL(p.price,''),
          ', Short Description: ', IFNULL(p.short_description,''),
          ', Full Description: ', IFNULL(p.full_description,''),
          ', Feature Text: ', IFNULL(p.feature_text,''),
          ', Benefit Text: ', IFNULL(p.benefit_text,''),
          ', How To Use: ', IFNULL(p.how_to_use,''),
          ', Ingredients: ', IFNULL(p.ingredients,''),
          '; Treatments: ', IFNULL(tagg.treatments_text,'None')
        ) AS embedding_text
      FROM tbl_products p
      LEFT JOIN (
        SELECT pt.product_id,
               GROUP_CONCAT(
                 DISTINCT CONCAT(
                   IFNULL(t.name,'N/A'), ' / ', IFNULL(t.swedish,''),
                   ' [Classification: ', IFNULL(t.classification_type,''),
                   ', Benefits EN: ', IFNULL(t.benefits_en,''),
                   ', Benefits SV: ', IFNULL(t.benefits_sv,''),
                   ', Description EN: ', IFNULL(t.description_en,''),
                   ', Description SV: ', IFNULL(t.description_sv,''),
                   ', Concerns: ', IFNULL(tcagg.concerns_text,'None'),
                   ']'
                 ) SEPARATOR '; '
               ) AS treatments_text
        FROM tbl_product_treatments pt
        JOIN tbl_treatments t ON pt.treatment_id = t.treatment_id
        LEFT JOIN (
          SELECT tc.treatment_id,
                 GROUP_CONCAT(
                   DISTINCT CONCAT(
                     IFNULL(c.name,'N/A'),
                     ' [EN: ', IFNULL(tc.indications_en,''),
                     ', SV: ', IFNULL(tc.indications_sv,''),
                     ', Likewise: ', IFNULL(tc.likewise_terms,''),
                     ']'
                   ) SEPARATOR ', '
                 ) AS concerns_text
          FROM tbl_treatment_concerns tc
          LEFT JOIN tbl_concerns c ON tc.concern_id = c.concern_id
          GROUP BY tc.treatment_id
        ) tcagg ON t.treatment_id = tcagg.treatment_id
        GROUP BY pt.product_id
      ) tagg ON p.product_id = tagg.product_id
      WHERE p.product_id = ?
      LIMIT 1;
    `, [product_id]);
    } catch (err) {
        console.error(`❌ Error fetching product ${product_id} embeddings:`, err);
        throw err;
    }
};

export const getTreatmentEmbeddingTextById = async (treatment_id) => {
    try {
        if (!treatment_id) throw new Error("Treatment ID is required");

        return await db.query(`
      SELECT 
        t.treatment_id,
        CONCAT(
          'Treatment Name: ', IFNULL(t.name, ''),
          ' / ', IFNULL(t.swedish, ''),
          ', Classification: ', IFNULL(t.classification_type, ''),
          ', Benefits EN: ', IFNULL(t.benefits_en, ''),
          ', Benefits SV: ', IFNULL(t.benefits_sv, ''),
          ', Description EN: ', IFNULL(t.description_en, ''),
          ', Description SV: ', IFNULL(t.description_sv, ''),
          '; Concerns: ',
          IFNULL(
            GROUP_CONCAT(
              DISTINCT CONCAT(
                c.name,
                ' [EN: ', IFNULL(tc.indications_en, ''),
                ', SV: ', IFNULL(tc.indications_sv, ''),
                ', Likewise: ', IFNULL(tc.likewise_terms, ''),
                ']'
              ) SEPARATOR '; '
            ), 'None'
          )
        ) AS embedding_text
      FROM tbl_treatments t
      LEFT JOIN tbl_treatment_concerns tc ON t.treatment_id = tc.treatment_id
      LEFT JOIN tbl_concerns c ON tc.concern_id = c.concern_id
      WHERE t.treatment_id = ?
      GROUP BY t.treatment_id
      LIMIT 1;
    `, [treatment_id]);

    } catch (err) {
        console.error(`❌ Error fetching treatment ${treatment_id} embeddings:`, err.message);
        console.error(err); // full stack for debugging
        throw err;
    }
};

export const getDoctorEmbeddingTextById = async (zynq_user_id) => {
    try {
        if (!zynq_user_id) throw new Error("zynq_user_id ID is required");

        return await db.query(`
      SELECT 
        d.doctor_id,
        CONCAT(
          'Expert Name: ', IFNULL(d.name, ''),
          ', Address: ', IFNULL(d.address, ''),
          ', Biography: ', IFNULL(d.biography, ''),
          ', Gender: ', IFNULL(d.gender, ''),
          ', Age: ', IFNULL(d.age, ''),
          ', Fee per session: ', IFNULL(d.fee_per_session, ''),
          '; Treatments: ', IFNULL(tagg.treatments_text, 'None'),
          '; Skin Types: ', IFNULL(stagg.skin_types_text, 'None'),
          '; Certifications: ', IFNULL(cagg.certifications_text, 'None'),
          '; Devices: ', IFNULL(dagg.devices_text, 'None'),
          '; Education: ', IFNULL(eagg.education_text, 'None'),
          '; Experience: ', IFNULL(exagg.experience_text, 'None')
        ) AS embedding_text
      FROM tbl_doctors d

      LEFT JOIN (
        SELECT dt.doctor_id,
               GROUP_CONCAT(DISTINCT CONCAT(
                 IFNULL(t.name, 'N/A'), ' / ', IFNULL(t.swedish, ''),
                 ' [Classification: ', IFNULL(t.classification_type, ''),
                 ', Benefits EN: ', IFNULL(t.benefits_en, ''),
                 ', Benefits SV: ', IFNULL(t.benefits_sv, ''),
                 ', Description EN: ', IFNULL(t.description_en, ''),
                 ', Description SV: ', IFNULL(t.description_sv, ''),
                 ', Concerns: ', IFNULL(tcagg.concerns_text, 'None'),
                 ']'
               ) SEPARATOR '; ') AS treatments_text
        FROM tbl_doctor_treatments dt
        JOIN tbl_treatments t ON dt.treatment_id = t.treatment_id
        LEFT JOIN (
          SELECT tc.treatment_id,
                 GROUP_CONCAT(DISTINCT CONCAT(
                   IFNULL(c.name,'N/A'),
                   ' [EN: ', IFNULL(tc.indications_en,''),
                   ', SV: ', IFNULL(tc.indications_sv,''),
                   ', Likewise: ', IFNULL(tc.likewise_terms,''),
                   ']'
                 ) SEPARATOR ', ') AS concerns_text
          FROM tbl_treatment_concerns tc
          LEFT JOIN tbl_concerns c ON tc.concern_id = c.concern_id
          GROUP BY tc.treatment_id
        ) tcagg ON t.treatment_id = tcagg.treatment_id
        GROUP BY dt.doctor_id
      ) tagg ON d.doctor_id = tagg.doctor_id

      LEFT JOIN (
        SELECT dst.doctor_id,
               GROUP_CONCAT(DISTINCT CONCAT(
                 IFNULL(st.name,'N/A'), ' / ', IFNULL(st.Swedish,''),
                 ' [English: ', IFNULL(st.English,''),
                 ', Description EN: ', IFNULL(st.description,''),
                 ', Description SV: ', IFNULL(st.desc_sv,''),
                 ', Who can do: ', IFNULL(st.who_can_do,''),
                 ', Areas: ', IFNULL(st.areas,''),
                 ', Synonyms EN: ', IFNULL(st.syn_en,''),
                 ', Synonyms SV: ', IFNULL(st.syn_sv,''),
                 ']'
               ) SEPARATOR '; ') AS skin_types_text
        FROM tbl_doctor_skin_types dst
        JOIN tbl_skin_types st ON dst.skin_type_id = st.skin_type_id
        GROUP BY dst.doctor_id
      ) stagg ON d.doctor_id = stagg.doctor_id

      LEFT JOIN (
        SELECT dc.doctor_id,
               GROUP_CONCAT(DISTINCT CONCAT(IFNULL(ct.name,'N/A'), ' / ', IFNULL(ct.swedish,'')) SEPARATOR '; ') AS certifications_text
        FROM tbl_doctor_certification dc
        JOIN tbl_certification_type ct ON dc.certification_type_id = ct.certification_type_id
        GROUP BY dc.doctor_id
      ) cagg ON d.doctor_id = cagg.doctor_id

      LEFT JOIN (
        SELECT dad.doctor_id,
               GROUP_CONCAT(DISTINCT CONCAT(
                 IFNULL(ad.device,'N/A'), ' [Category: ', IFNULL(ad.category,''),
                 ', Manufacturer: ', IFNULL(ad.manufacturer,''),
                 ', Distributor: ', IFNULL(ad.swedish_distributor,''),
                 ', Application: ', IFNULL(ad.main_application,''),
                 ']'
               ) SEPARATOR '; ') AS devices_text
        FROM tbl_doctor_aesthetic_devices dad
        JOIN tbl_aesthetic_devices ad ON dad.aesthetic_devices_id = ad.aesthetic_device_id
        GROUP BY dad.doctor_id
      ) dagg ON d.doctor_id = dagg.doctor_id

      LEFT JOIN (
        SELECT doctor_id,
               GROUP_CONCAT(DISTINCT CONCAT(IFNULL(degree,'N/A'), ' - ', IFNULL(institution,'')) SEPARATOR '; ') AS education_text
        FROM tbl_doctor_educations
        GROUP BY doctor_id
      ) eagg ON d.doctor_id = eagg.doctor_id

      LEFT JOIN (
        SELECT doctor_id,
               GROUP_CONCAT(DISTINCT CONCAT(IFNULL(organization,'N/A'), ' - ', IFNULL(designation,'')) SEPARATOR '; ') AS experience_text
        FROM tbl_doctor_experiences
        GROUP BY doctor_id
      ) exagg ON d.doctor_id = exagg.doctor_id

      WHERE d.zynq_user_id = ?
      LIMIT 1;
    `, [zynq_user_id]);

    } catch (err) {
        console.error(`❌ Error fetching doctor ${zynq_user_id} embeddings:`, err);
        throw err;
    }
};

export const getDoctorEmbeddingTextByIdV2 = async (zynq_user_id) => {
    try {
        if (!zynq_user_id) throw new Error("zynq_user_id ID is required");

        return await db.query(`
        SELECT 
          d.doctor_id,
          d.name AS doctor_name,
          GROUP_CONCAT(DISTINCT t.name SEPARATOR ', ') AS treatments,
          GROUP_CONCAT(DISTINCT c.name SEPARATOR ', ') AS concerns,
          GROUP_CONCAT(DISTINCT st.name SEPARATOR ', ') AS skin_types,
          GROUP_CONCAT(DISTINCT ct.name SEPARATOR ', ') AS certifications,
          GROUP_CONCAT(DISTINCT de.degree SEPARATOR ', ') AS educations,
        FROM tbl_doctors d
        LEFT JOIN tbl_doctor_treatments dt ON d.doctor_id = dt.doctor_id
        LEFT JOIN tbl_treatments t ON dt.treatment_id = t.treatment_id
        LEFT JOIN tbl_treatment_concerns tc ON t.treatment_id = tc.treatment_id
        LEFT JOIN tbl_concerns c ON tc.concern_id = c.concern_id
        LEFT JOIN tbl_doctor_skin_types dst ON d.doctor_id = dst.doctor_id
        LEFT JOIN tbl_skin_types st ON dst.skin_type_id = st.skin_type_id
        LEFT JOIN tbl_doctor_certification dc ON d.doctor_id = dc.doctor_id
        LEFT JOIN tbl_certification_type ct ON dc.certification_type_id = ct.certification_type_id
        LEFT JOIN tbl_doctor_educations de ON d.doctor_id = de.doctor_id
        WHERE d.zynq_user_id = ?
        GROUP BY d.doctor_id
        LIMIT 1;
      `, [zynq_user_id]);

    } catch (err) {
        console.error(`❌ Error fetching doctor ${zynq_user_id} embeddings:`, err);
        throw err;
    }
};
export const getDoctorEmbeddingTextAllV2 = async () => {
    try {
        return await db.query(`
        SELECT 
          d.doctor_id,
          d.name AS doctor_name,
          GROUP_CONCAT(DISTINCT t.name SEPARATOR ', ') AS treatments,
          GROUP_CONCAT(DISTINCT c.name SEPARATOR ', ') AS concerns,
          GROUP_CONCAT(DISTINCT st.name SEPARATOR ', ') AS skin_types,
          GROUP_CONCAT(DISTINCT de.degree SEPARATOR ', ') AS educations
        FROM tbl_doctors d
        LEFT JOIN tbl_doctor_treatments dt ON d.doctor_id = dt.doctor_id
        LEFT JOIN tbl_treatments t ON dt.treatment_id = t.treatment_id
        LEFT JOIN tbl_treatment_concerns tc ON t.treatment_id = tc.treatment_id
        LEFT JOIN tbl_concerns c ON tc.concern_id = c.concern_id
        LEFT JOIN tbl_doctor_skin_types dst ON d.doctor_id = dst.doctor_id
        LEFT JOIN tbl_skin_types st ON dst.skin_type_id = st.skin_type_id
        LEFT JOIN tbl_doctor_certification dc ON d.doctor_id = dc.doctor_id
        LEFT JOIN tbl_certification_type ct ON dc.certification_type_id = ct.certification_type_id
        LEFT JOIN tbl_doctor_educations de ON d.doctor_id = de.doctor_id
        GROUP BY d.doctor_id;
      `);
    } catch (err) {
        console.error(`❌ Error fetching all doctor embeddings:`, err);
        throw err;
    }
};


export const getClinicEmbeddingTextByAllV2 = async () => {
    try {

        const query = `
        SELECT 
          c.clinic_id,
          c.clinic_name,
          c.address
        FROM tbl_clinics c
        WHERE c.profile_status = 'VERIFIED'
      `;

        return await db.query(query);
    } catch (err) {
        console.error(`❌ Error fetching clinic data:`, err);
        throw err;
    }
};


export const getTreatmentEmbeddingsText = async () => {
    try {
        return await db.query(`
      SELECT 
        t.treatment_id,
        CONCAT(
          'Treatment Name: ', IFNULL(t.name, ''),
          ' / ', IFNULL(t.swedish, ''),
          ', Classification: ', IFNULL(t.classification_type, ''),
          ', Benefits EN: ', IFNULL(t.benefits_en, ''),
          ', Benefits SV: ', IFNULL(t.benefits_sv, ''),
          ', Description EN: ', IFNULL(t.description_en, ''),
          ', Description SV: ', IFNULL(t.description_sv, ''),
          '; Concerns: ',
          IFNULL(
            GROUP_CONCAT(
              DISTINCT CONCAT(
                c.name,
                ' [EN: ', IFNULL(tc.indications_en, ''),
                ', SV: ', IFNULL(tc.indications_sv, ''),
                ', Likewise: ', IFNULL(tc.likewise_terms, ''),
                ']'
              ) SEPARATOR '; '
            ), 'None'
          )
        ) AS embedding_text
      FROM tbl_treatments t
      LEFT JOIN tbl_treatment_concerns tc ON t.treatment_id = tc.treatment_id
      LEFT JOIN tbl_concerns c ON tc.concern_id = c.concern_id
      GROUP BY t.treatment_id
;
    `,);

    } catch (err) {
        console.error(`❌ Error fetching treatments embeddings:`, err.message);
        console.error(err); // full stack for debugging
        throw err;
    }
};
export const getTreatmentEmbeddingsText2 = async () => {
    try {
        return await db.query(`
      SELECT 
        t.treatment_id,
        CONCAT(
          'Treatment Name: ', IFNULL(t.name, ''),
          ' / ', IFNULL(t.swedish, ''),
          ', Classification: ', IFNULL(t.classification_type, ''),
          ', Benefits EN: ', IFNULL(t.benefits_en, ''),
          ', Benefits SV: ', IFNULL(t.benefits_sv, ''),
          ', Description EN: ', IFNULL(t.description_en, ''),
          ', Description SV: ', IFNULL(t.description_sv, ''),
          '; Concerns: ',
          IFNULL(
            GROUP_CONCAT(
              DISTINCT CONCAT(
                c.name,
                ' [EN: ', IFNULL(tc.indications_en, ''),
                ', SV: ', IFNULL(tc.indications_sv, ''),
                ', Likewise: ', IFNULL(tc.likewise_terms, ''),
                ']'
              ) SEPARATOR '; '
            ), 'None'
          )
        ) AS embedding_text
      FROM tbl_treatments t
      LEFT JOIN tbl_treatment_concerns tc ON t.treatment_id = tc.treatment_id
      LEFT JOIN tbl_concerns c ON tc.concern_id = c.concern_id
      GROUP BY t.treatment_id
;
    `,);

    } catch (err) {
        console.error(`❌ Error fetching treatments embeddings:`, err.message);
        console.error(err); // full stack for debugging
        throw err;
    }
};

export const getTreatmentsByTreatmentIdsAndClinicIdAndDocterId = async (
    treatment_ids = [],
    lang,
    doctor_id,
    clinic_id
) => {
    try {
        // 1️⃣ Deduplicate treatment IDs
        const uniqueTreatmentIds = [...new Set(treatment_ids)];

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
    t.embeddings,
    t.name_embeddings,
    t.created_at,
        ANY_VALUE(c.name) AS concern_name,
        ANY_VALUE(c.swedish) AS concern_name_swedish,
        dt.price AS doctor_price,
        dt.sub_treatment_id,
        dt.sub_treatment_price,
        tstm.name AS sub_treatment_name,
        tstm.swedish AS sub_treatment_swedish,
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
      FROM tbl_treatments t
      INNER JOIN tbl_doctor_treatments dt 
        ON dt.treatment_id = t.treatment_id
      LEFT JOIN tbl_treatment_concerns tc 
        ON tc.treatment_id = t.treatment_id
      LEFT JOIN tbl_concerns c 
        ON c.concern_id = tc.concern_id
      LEFT JOIN tbl_treatment_sub_treatments ttst 
        ON dt.sub_treatment_id = ttst.sub_treatment_id
      LEFT JOIN tbl_sub_treatment_master tstm 
        ON ttst.sub_treatment_id = tstm.sub_treatment_id

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
    `;

        const whereClauses = [];
        const params = [];

        if (uniqueTreatmentIds.length > 0) {
            const placeholders = uniqueTreatmentIds.map(() => '?').join(',');
            whereClauses.push(`t.treatment_id IN (${placeholders})`);
            params.push(...uniqueTreatmentIds);
        }

        if (doctor_id) {
            whereClauses.push(`dt.doctor_id = ?`);
            params.push(doctor_id);
        }

        if (clinic_id) {
            whereClauses.push(`dt.clinic_id = ?`);
            params.push(clinic_id);
        }

        if (whereClauses.length) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += ` GROUP BY t.treatment_id, dt.price,
            dt.sub_treatment_id,
            dt.sub_treatment_price,
            tstm.name,
            tstm.swedish`;

        const rawRows = await db.query(query, params);

        // 2️⃣ Group by treatment
        const treatmentMap = {};

        for (const row of rawRows) {
            const id = row.treatment_id;

            if (!treatmentMap[id]) {
                treatmentMap[id] = {
                    ...row,
                    min_price: row.doctor_price || 0,
                    max_price: row.doctor_price || 0,
                    sub_treatments: [],
                    sub_treatment_set: new Set(),
                };
            }

            if (row.doctor_price) {
                treatmentMap[id].min_price = Math.min(
                    treatmentMap[id].min_price,
                    row.doctor_price
                );
                treatmentMap[id].max_price = Math.max(
                    treatmentMap[id].max_price,
                    row.doctor_price
                );
            }

            if (
                row.sub_treatment_id &&
                !treatmentMap[id].sub_treatment_set.has(row.sub_treatment_id)
            ) {
                treatmentMap[id].sub_treatment_set.add(row.sub_treatment_id);

                treatmentMap[id].sub_treatments.push({
                    sub_treatment_id: row.sub_treatment_id,
                    name:
                        lang === 'swedish'
                            ? row.sub_treatment_swedish
                            : row.sub_treatment_name,
                    price: row.sub_treatment_price || 0,
                });
            }
        }

        let results = Object.values(treatmentMap).map(r => {
            delete r.sub_treatment_set;
            delete r.embeddings;
            delete r.name_embeddings;
            return r;
        });

        return formatBenefitsUnified(results, lang);

    } catch (error) {
        console.error(
            'Database Error in getTreatmentsByTreatmentIdsAndClinicIdAndDocterId:',
            error.message
        );
        throw new Error('Failed to fetch treatments.');
    }
};
