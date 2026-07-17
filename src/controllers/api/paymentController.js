import { createPaymentSession, getCartMetadataAndStatusByCartId, getProductsByCartId, getProductsData, insertPayment, insertProductPurchase, processPaymentMetadata, updateCartMetadata, updateCartPurchasedStatus, updateLatestAddress, updatePaymentStatus, updatePaymentStatusModel, updateProductsStock, updateProductsStockBulk, updateShipmentStatusModel } from "../../models/payment.js";
import db from "../../config/db.js";
import { NOTIFICATION_MESSAGES, sendNotification } from "../../services/notifications.service.js";
import {
    asyncHandler,
    handleError,
    handleSuccess,
} from "../../utils/responseHandler.js";
import { v4 as uuidv4 } from "uuid";
import { isEmpty } from "../../utils/user_helper.js";
import { orderConfirmationTemplate, orderConfirmationTemplateClinic } from "../../utils/templates.js";
import { sendEmail } from "../../services/send_email.js";
import dayjs from 'dayjs';
import { getSingleAddressByAddressId } from "../../models/address.js";
import { getAdminCommissionRatesModel } from "../../models/admin.js";
import { stripe } from "../../../app.js";
import configs from "../../config/config.js";

import dotenv from "dotenv";

dotenv.config();

const APP_URL = process.env.APP_URL;

export const process_earnings = async (
    metadata,
    user_id,
    products,
    cart_id,
    productDetails,
    PRODUCT_COMMISSION,
) => {
    try {
        // Step 1️⃣: Compute subtotal
        const subtotal = products.reduce(
            (acc, item) => acc + Number(item.total_price || 0),
            0
        );

        if (isNaN(subtotal) || subtotal <= 0) {
            throw new Error("Invalid subtotal calculated");
        }
        const VAT_PERCENTAGE = configs.VAT || 25;
        // Step 2️⃣: Calculate VAT
        const vat_amount = Number(((subtotal * VAT_PERCENTAGE) / 100).toFixed(2));

        // Step 3️⃣: Calculate total (includes VAT)
        const total_price = Number((subtotal + vat_amount).toFixed(2));

        // Step 4️⃣: Commission logic (admin share on pre-VAT subtotal)
        const admin_percentage = Number(PRODUCT_COMMISSION) || 3;

        const admin_base_earning = Number(((subtotal * admin_percentage) / 100).toFixed(2));
        const clinic_earning = Number((subtotal - admin_base_earning).toFixed(2));

        // Step 5️⃣: Add VAT entirely to admin
        const admin_earning_final = Number((admin_base_earning + vat_amount).toFixed(2));

        // Step 6️⃣: Sanity validation
        if ([subtotal, vat_amount, total_price, admin_earning_final, clinic_earning].some(isNaN)) {
            throw new Error("NaN detected in earnings computation");
        }

        // Step 7️⃣: Enriched metadata
        const enrichedMetadata = {
            ...metadata,
            user_id,
            cart_id,
            subtotal,
            vat_amount,
            total_price,
            order_amount: total_price,
            admin_earnings: admin_earning_final,
            clinic_earnings: clinic_earning,
            products: JSON.stringify(products),
            product_details: JSON.stringify(productDetails),
        };

        return {
            status: "SUCCESS",
            message: "Earnings processed successfully",
            subtotal,
            vat_amount,
            total_price,
            metadata: enrichedMetadata,
        };
    } catch (error) {
        return {
            status: "FAILED",
            message: `Error in process_earnings - ${error.message || "Unknown error"}`,
        };
    }
};

const check_cart_stock = async (metadata) => {
    const [cart_id] = metadata.type_data.map((item) => item.type_id);

    const [products, productDetails, address_data, [{ PRODUCT_COMMISSION }]] = await Promise.all([
        getProductsData(cart_id),
        getProductsByCartId(cart_id),
        getSingleAddressByAddressId(metadata.address_id),
        getAdminCommissionRatesModel()
    ]);

    if (!products || products.length === 0) {
        return {
            status: "FAILED",
            message: "No products found in cart.",
        };
    }

    for (const product of products) {
        if (product.cart_status === "PURCHASED") {
            return {
                status: "FAILED",
                message: `Cart has already been purchased.`,
            }
        }

        if (product.stock < product.cart_quantity) {
            return {
                status: "FAILED",
                message: `${product.name} is out of stock.`,
            };
        }
    }

    return { status: "SUCCESS", products, cart_id, productDetails, address_data, PRODUCT_COMMISSION };
};

export const initiatePayment = asyncHandler(async (req, res) => {
    let { payment_gateway, metadata, address_id, redirect_url, cancel_url } = req.body;
    const { user_id, language = "en" } = req.user;
    metadata.address_id = address_id;

    const stockCheck = await check_cart_stock(metadata);
    if (stockCheck.status === "FAILED") {
        return handleError(res, 400, language, stockCheck.message);
    }

    const { products, cart_id, productDetails, PRODUCT_COMMISSION } = stockCheck;
    metadata.address_data = stockCheck.address_data[0];
    metadata.userData = req.user;
    metadata.products = products;

    const earningResult = await process_earnings(
        metadata,
        user_id,
        products,
        cart_id,
        productDetails,
        PRODUCT_COMMISSION
    );

    if (earningResult.status === "FAILED") {
        return handleError(res, 500, language, earningResult.message);
    }

    const processedMetadata = processPaymentMetadata({
        payment_gateway,
        metadata: earningResult.metadata,
    });

    const [session, cart] = await Promise.all([
        createPaymentSession({
            payment_gateway,
            metadata: processedMetadata,
            redirect_url,
            cancel_url
        }),
        updateCartMetadata(cart_id, processedMetadata),
    ])

    return handleSuccess(res, 200, language, "Payment initiated successfully", {
        status: earningResult.status,
        message: earningResult.message,
        url: session.url
    });

});

export const updateShipmentStatus = asyncHandler(async (req, res) => {
    const { purchase_id, shipment_status } = req.body;
    const language = req?.user?.language || 'en';
    const userData = req.user;
    await updateShipmentStatusModel(purchase_id, shipment_status, userData);
    return handleSuccess(res, 200, language, "SHIPMENT_STATUS_UPDATED_SUCCESSFULLY");
});

export const stripeWebhookHandler = asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];

    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    // await updatePaymentStatusModel(session_id, "PAID");
    return handleSuccess(res, 200, "en", "PAYMENT_STATUS_UPDATED_SUCCESSFULLY");
});

export const stripeSuccessHandler = asyncHandler(async (req, res) => {
    const { session_id } = req.query;

    const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ["payment_intent", "line_items"], // expand if needed
    });

    const { metadata, cart_status } = await getCartMetadataAndStatusByCartId(session.metadata.cart_id);

    if (cart_status === "PURCHASED") {
        return handleError(res, 400, "en", "Cart has already been purchased.");

    }

    const { insertId: purchase_id } = await insertProductPurchase(
        metadata.user_id,
        metadata.cart_id,
        metadata.total_price,
        metadata.admin_earnings,
        metadata.clinic_earnings,
        metadata.product_details,
        metadata.address_id,
        metadata.vat_amount,
        metadata.subtotal
    );

    let pro = []
    const products = JSON.parse(metadata.products);
    products.map((product) => {
        let data = {
            product_id: product.product_id,
            name: product.name,
            price: product.unit_price,
            quantity: product.cart_quantity,
            image_url: product.image_url || "product_img.png",
        }
        pro.push(data);
    });
    const emailData = {
        orderDate: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        customerName: metadata.userData.full_name || "Customer",
        totalAmount: metadata.total_price,
        products: pro,
        logoUrl: process.env.LOGO_URL, // Optional - defaults to logo_2.png
        bannerImageUrl: `${APP_URL}product_main.png`,
        customerAddress: metadata.address_data?.address || "Not provided",
        customerState: metadata.address_data?.state || "Not provided",
        customerCity: metadata.address_data?.city || "Not provided",
        customerzipCode: metadata.address_data?.zip_code || "Not provided",
        customerPhoneNumber: metadata.address_data?.phone_number || "Not provided",
        clinicName: products[0].clinic_name || "Clinic",
        clinicAddress: products[0].clinic_address || "Clinic Address",
    };

    const emailTemplate = orderConfirmationTemplate(emailData);
    const emailClinicTemlate = orderConfirmationTemplateClinic(emailData);

    const promises = [
        updateProductsStockBulk(products),
        updateCartPurchasedStatus(metadata.cart_id),
        sendEmail({
            to: metadata.userData.email,
            subject: emailTemplate.subject,
            html: emailTemplate.body,
        }),

        sendEmail({
            to: products[0].clinic_email,
            subject: emailClinicTemlate.subject,
            html: emailClinicTemlate.body,
        })
        ,
        sendNotification({
            userData: metadata.userData,
            type: "PURCHASE",
            type_id: `${purchase_id}`,
            notification_type: NOTIFICATION_MESSAGES.cart_purchased,
            receiver_id: products[0].clinic_id,
            receiver_type: "CLINIC"
        }),

        sendNotification({
            userData: {
                user_id: products[0]?.clinic_id,
                role: "CLINIC",
                full_name: products[0]?.clinic_name || "Clinic",
                token: products[0]?.token || null
            },
            type: "PURCHASE",
            type_id: `${purchase_id}`,
            notification_type: NOTIFICATION_MESSAGES.cart_purchased_user,
            receiver_id: metadata.user_id,
            receiver_type: "USER",
            system: true
        }),
    ];

    if (metadata.address_id) {
        promises.push(updateLatestAddress(metadata.user_id, metadata.address_id));
    }

    await Promise.all(promises);

    return handleSuccess(res, 200, "en", "PAYMENT_PROCESSED_SUCCESSFULLY", { purchase_id });
});

export const stripeCancelHandler = asyncHandler(async (req, res) => {
    const { appointment_id, session_id, redirect_url } = req.query;

    console.log(`🧹 Intercepted Stripe Cancel Redirect for Appointment: ${appointment_id}, Session: ${session_id}`);

    try {
        // 1. Expire the Stripe Checkout Session immediately
        if (session_id && stripe) {
            try {
                await stripe.checkout.sessions.expire(session_id);
                console.log(`✅ Successfully expired Stripe session: ${session_id}`);
            } catch (expireErr) {
                console.error(`⚠️ Failed to expire Stripe session ${session_id}:`, expireErr.message);
            }
        }

        // 2. Mark the appointment status as 'Cancelled' and payment_status as 'failed' in DB
        if (appointment_id) {
            await db.query(
                `UPDATE tbl_appointments SET status = 'Cancelled', payment_status = 'failed' WHERE appointment_id = ?`,
                [appointment_id]
            );
            console.log(`✅ Marked appointment ${appointment_id} as Cancelled in DB`);
        }
    } catch (err) {
        console.error("❌ Error in stripeCancelHandler:", err.message);
    }

    // 3. Redirect back to the app's original redirect URL
    if (redirect_url) {
        return res.redirect(redirect_url);
    }

    return handleSuccess(res, 200, "en", "PAYMENT_CANCELLED_SUCCESSFULLY");
});

export const testPayment = asyncHandler(async (req, res) => {
    const session = await createPaymentSession(
        {
            payment_gateway: "KLARNA",
            metadata: {
                order_lines: [
                    {
                        name: "Test",
                        quantity: 1,
                        unit_amount: 100 * 100,
                    }]
            }
        });
    return handleSuccess(res, 200, "en", "SESSION_CREATED_SUCCESSFULLY", session);
})