import * as apiModels from '../../models/api.js';
import { v4 as uuidv4 } from 'uuid';
import { handleError, handleSuccess } from '../../utils/responseHandler.js';

export const save_test_run_scan_result = async (req, res) => {
    try {
        const output = req.body?.data?.results?.output;
        const payload = JSON.stringify(req.body);
        const test_run_scan_result_id = uuidv4();

        const insertPayload = {
            test_run_scan_result_id,
            request_status: req.body?.status ?? null,
            task_status: req.body?.data?.task_status ?? null,
            output_count: Array.isArray(output) ? output.length : 0,
            payload,
        };

        await apiModels.save_test_run_scan_result(insertPayload);

        return handleSuccess(res, 200, 'en', 'TEST_RUN_SAVED_SUCCESSFULLY', {
            test_run_scan_result_id,
        });
    } catch (error) {
        console.error('Error in save_test_run_scan_result:', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const get_test_run_scan_results = async (req, res) => {
    try {
        const scan_id = req.query?.scan_id || null;
        const rows = await apiModels.get_test_run_scan_results(scan_id);

        const results = rows.map((row) => {
            let parsedPayload = row.payload;
            try {
                parsedPayload = JSON.parse(row.payload);
            } catch (_) {
                parsedPayload = row.payload;
            }

            return {
                test_run_scan_result_id: row.test_run_scan_result_id,
                request_status: row.request_status,
                task_status: row.task_status,
                output_count: row.output_count,
                payload: parsedPayload,
                created_at: row.created_at,
                updated_at: row.updated_at,
            };
        });

        return handleSuccess(res, 200, 'en', 'TEST_RUN_RESULTS_FETCHED_SUCCESSFULLY', results);
    } catch (error) {
        console.error('Error in get_test_run_scan_results:', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};
