import { stripe } from "../../app.js";
import db from "../config/db.js";
import { NOTIFICATION_MESSAGES, sendNotification } from "../services/notifications.service.js";
import { get_user_by_user_id, getSinglePurchasedProductsModel } from "./api.js";
import dotenv from "dotenv";
import * as appointmentModel from "./appointment.js";
import { getDocterByDocterId } from "./doctor.js";
import { getAppointmentDetails } from "../utils/user_helper.js";
import { sendAppointmentConfirmationNotifications } from "../controllers/api/appointmentController.js";

dotenv.config();

const CLINIC_URL = process.env.CLINIC_URL;

export const insertPayment = async (
  amount,
  type,
  type_id,
  session_id,
  metadata
) => {
  const query = `
    INSERT INTO tbl_payments (
      amount,
      status,
      type,
      type_id,
      session_id,
      metadata
    ) VALUES (?, ?, ?, ?, ?, ?)
  `;

  const params = [
    amount,
    "PENDING",
    type,
    type_id,
    session_id,
    JSON.stringify(metadata),
  ];

  try {
    await db.query(query, params);
  } catch (err) {
    console.error("Failed to insert payment:", err);
    throw err;
  }
};

export const getAppointmentsData = async (appointment_ids) => {
  try {
    const query = `
      SELECT 
        a.appointment_id,
        CONCAT(d.name, ' ', 'Appointment') AS name, 
        d.fee_per_session AS unit_price
      FROM tbl_appointments a
      LEFT JOIN tbl_doctors d ON a.doctor_id = d.doctor_id
      WHERE a.appointment_id IN (?)
    `;
    const results = await db.query(query, [appointment_ids]);
    return results;
  } catch (error) {
    console.error("Failed to fetch appointments data:", error);
    throw error;
  }
};

export const getTreatmentsData = async (treatment_ids, doctor_id) => {
  try {
    const query = `
      SELECT 
        t.treatment_id,
        t.name AS name, 
        dt.price AS unit_price
      FROM tbl_treatments t
      LEFT JOIN tbl_doctor_treatments dt ON dt.treatment_id = t.treatment_id
      t.treatment_id IN (?) AND dt.doctor_id = ?
    `;
    const results = await db.query(query, [treatment_ids, doctor_id]);
    return results;
  } catch (error) {
    console.error("Failed to fetch appointments data:", error);
    throw error;
  }
};

export const getClinicDoctorWallets = async () => {
  try {
    const clinicQuery = `
      SELECT 
        c.clinic_id AS id,
        c.clinic_name AS name,
        c.wallet_balance,
        c.due_status,
        'CLINIC' AS type
      FROM tbl_clinics c
      WHERE c.due_status = ?
    `;

    const doctorQuery = `
      SELECT 
        d.doctor_id AS id,
        d.name,
        d.wallet_balance,
        d.due_status,
        'DOCTOR' AS type
      FROM tbl_doctors d
      WHERE d.due_status = ?
    `;

    const [clinicWallets, doctorWallets] = await Promise.all([
      db.query(clinicQuery, ["DUE_PENDING"]),
      db.query(doctorQuery, ["DUE_PENDING"]),
    ]);

    return [...clinicWallets, ...doctorWallets];
  } catch (error) {
    console.error("Failed to fetch wallet data:", error);
    throw error;
  }
};

export const updatePaymentStatus = async (order_id, status) => {
  try {
    const query = `UPDATE tbl_payments SET status = ? WHERE order_id = ?`;
    await db.query(query, [status, order_id]);
  } catch (error) {
    console.error("Failed to update payment status:", error);
    throw error;
  }
};

export const getProductsData = async (cart_id) => {
  try {
    const query = `
      SELECT
        cp.product_id,
        p.name AS name,
        p.price AS unit_price,
        c.cart_status,
        c.clinic_id,
        cl.clinic_name,
        cl.address AS clinic_address,
        zu.email AS clinic_email,
        zu.fcm_token AS token,
        p.stock,
        cp.quantity as cart_quantity,
        ROUND(p.price * cp.quantity, 2) AS total_price
      FROM tbl_cart_products cp
      LEFT JOIN tbl_products p ON cp.product_id = p.product_id
      LEFT JOIN tbl_carts c ON cp.cart_id = c.cart_id
      LEFT JOIN tbl_clinics cl ON c.clinic_id = cl.clinic_id
      LEFT JOIN tbl_zqnq_users zu ON cl.zynq_user_id = zu.id
      WHERE cp.cart_id = ?
    `;
    const results = await db.query(query, [cart_id]);
    return results;
  } catch (error) {
    console.error("Failed to fetch appointments data:", error);
    throw error;
  }
};

export const getProductsByCartId = async (cart_id) => {
  try {
    const query = `
      SELECT
        p.*, cp.quantity as cart_quantity
      FROM tbl_cart_products cp
      LEFT JOIN tbl_products p ON cp.product_id = p.product_id
      WHERE cp.cart_id = ?
    `;
    const results = await db.query(query, [cart_id]);
    return results;
  } catch (error) {
    console.error("Failed to fetch appointments data:", error);
    throw error;
  }
};

export const updateProductsStock = async (product_id, stock) => {
  try {
    const query = `
      UPDATE tbl_products SET stock = ? WHERE  product_id = ?
    `;
    const results = await db.query(query, [stock, product_id]);
    return results;
  } catch (error) {
    console.error("Failed to fetch appointments data:", error);
    throw error;
  }
};

export const updateProductsStockBulk = async (items) => {
  if (!items.length) return;

  try {
    const cases = items
      .map(
        (item) =>
          `WHEN '${item.product_id}' THEN ${item.stock - item.cart_quantity}`
      )
      .join(" ");

    const productIds = items.map((item) => `'${item.product_id}'`).join(",");

    const query = `
      UPDATE tbl_products
      SET stock = CASE product_id
        ${cases}
      END
      WHERE product_id IN (${productIds})
    `;

    return await db.query(query);
  } catch (error) {
    console.error("❌ Failed to bulk update product stock:", error);
    throw error;
  }
};


export const updateCartPurchasedStatus = async (cart_id) => {
  try {
    const query = `
      UPDATE tbl_carts SET cart_status = "PURCHASED" WHERE  cart_id = ?
    `;
    const results = await db.query(query, [cart_id]);
    return results;
  } catch (error) {
    console.error("Failed to fetch appointments data:", error);
    throw error;
  }
};

export const updateLatestAddress = async (user_id, address_id) => {
  try {
    const unselectQuery = `UPDATE tbl_address SET is_selected = 0 WHERE user_id = ?`;
    await db.query(unselectQuery, [user_id]);

    const selectQuery = `UPDATE tbl_address SET is_selected = 1 WHERE address_id = ?`;
    const results = await db.query(selectQuery, [address_id]);

    return results;
  } catch (error) {
    console.error("Failed to update address data:", error);
    throw error;
  }
};


export const getCartsTotalPrice = async (cart_id) => {
  try {
    const query = `
      SELECT
    SUM(cp.quantity * p.price) AS total_price
FROM tbl_cart_products cp
LEFT JOIN tbl_products p ON cp.product_id = p.product_id
WHERE cp.cart_id = ?
    `;
    const results = await db.query(query, [cart_id]);
    return results;
  } catch (error) {
    console.error("Failed to fetch appointments data:", error);
    throw error;
  }
};

export const insertProductPurchase = async (
  user_id,
  cart_id,
  total_price,
  admin_earnings,
  clinic_earnings,
  productDetails,
  address_id = null,
  vat_amount,
  subtotal
) => (
  await db.query(
    `
      INSERT INTO tbl_product_purchase (
        user_id,
        cart_id,
        total_price,
        admin_earnings,
        clinic_earnings,
        product_details,
        address_id,
        vat_amount,
        subtotal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [user_id,
      cart_id,
      total_price,
      admin_earnings,
      clinic_earnings,
      productDetails,
      address_id,
      vat_amount,
      subtotal
    ]
  )
)

export const updateShipmentStatusModel = async (purchase_id, shipment_status, userData) => {
  try {
    let dateColumn = null;

    const [purchaseData] = await getSinglePurchasedProductsModel(purchase_id);

    if (purchaseData) {
      if (shipment_status === "SHIPPED") {
        dateColumn = "shipped_date";

        sendNotification({
          userData: userData,
          type: "SHIPMENT",
          type_id: purchase_id,
          notification_type: NOTIFICATION_MESSAGES.shipment_shipped,
          receiver_type: "USER",
          receiver_id: purchaseData.user_id
        })

      } else if (shipment_status === "DELIVERED") {
        dateColumn = "delivered_date";
        sendNotification({
          userData: userData,
          type: "SHIPMENT",
          type_id: purchase_id,
          notification_type: NOTIFICATION_MESSAGES.shipment_delivered,
          receiver_type: "USER",
          receiver_id: purchaseData.user_id
        })
      }

      // Base query
      let query = `UPDATE tbl_product_purchase SET shipment_status = ?`;
      const params = [shipment_status];

      // Add date update if applicable
      if (dateColumn) {
        query += `, ${dateColumn} = CURRENT_TIMESTAMP`;
      }

      query += ` WHERE purchase_id = ?`;
      params.push(purchase_id);

      await db.query(query, params);
    }


  } catch (error) {
    console.error("Failed to update shipment status:", error);
    throw error;
  }
};

export const processKlarnaMetadata = (metadata) => {
  let order_lines = [];

  order_lines.push({
    name: `Order #${metadata.type_data[0].type_id}`,
    quantity: 1,
    unit_amount: Math.round(metadata.order_amount * 100),
    total_amount: Math.round(metadata.order_amount * 100),
  });



  const order_amount_minor = order_lines.reduce(
    (sum, item) => sum + item.total_amount,
    0
  );

  const order_amount = order_amount_minor / 100;

  return {
    ...metadata,
    cart_id: metadata.type_data[0].type_id,
    order_lines,
    order_amount, // for DB clarity (major units)
    order_amount_minor, // for Stripe/Klarna (minor units)
  };
};

export const processPaymentMetadata = ({ payment_gateway, metadata }) => {
  try {
    switch (payment_gateway) {
      case "KLARNA":
        return processKlarnaMetadata(metadata);

      case "SWISH":
        break;

      default:
        break;
    }
  } catch (error) {
    console.error("Failed to process payment metadata:", error);
    throw error;
  }
}

const payment_types = ["card", "alipay", "bancontact", "blik", "eps", "giropay", "ideal",
  "klarna", "link", "multibanco", "p24", "paypal", "sepa_debit", "sofort", "us_bank_account",
  "revolut_pay", "mobilepay", "amazon_pay", "twint", "kr_card", "naver_pay", "kakao_pay", "payco",
  "samsung_pay", "billie",
]

export const createPaymentSession = async ({ payment_gateway, metadata, redirect_url, cancel_url }) => {
  try {
    switch (payment_gateway) {
      case "KLARNA": {
        const line_items = metadata.order_lines.map((line) => ({
          price_data: {
            currency: metadata.currency || "sek",
            product_data: { name: line.name },
            unit_amount: line.unit_amount,
          },
          quantity: line.quantity,
        }));

        const success_url = `${CLINIC_URL}payment-success/?session_id={CHECKOUT_SESSION_ID}&redirect_url=${redirect_url}`;
        const redirect_cancel_url = `${CLINIC_URL}payment-cancel/?redirect_url=${cancel_url}`;

        return await stripe.checkout.sessions.create({
          payment_method_types: payment_types,
          mode: "payment",
          line_items,
          success_url,
          cancel_url: redirect_cancel_url,
          metadata: {
            cart_id: metadata.cart_id,
            user_id: metadata.user_id,
            type: metadata.type,
          },
        });
      }

      default:
        throw new Error(`Unsupported payment gateway: ${payment_gateway}`);
    }
  } catch (error) {
    console.error("Failed to create payment session:", error);
    throw error;
  }
};


export const updatePaymentStatusModel = async (session_id, status) => {
  try {
    await db.query(
      `
        UPDATE tbl_payments
        SET status = ?
        WHERE session_id = ?
      `,
      [status, session_id]
    );
  } catch (error) {
    console.error("Failed to update payment status:", error);
    throw error;
  }
}

export const updateCartMetadata = async (cart_id, metadata) => {
  try {
    await db.query(
      `
        UPDATE tbl_carts
        SET metadata = ?
        WHERE cart_id = ?
      `,
      [JSON.stringify(metadata), cart_id]
    );
  } catch (error) {
    console.error("Failed to update cart metadata:", error);
    throw error;
  }
}


export const getCartMetadataAndStatusByCartId = async (cart_id) => {
  try {
    const [result] = await db.query(
      `SELECT metadata, cart_status FROM tbl_carts WHERE cart_id = ?
             `,
      [cart_id]
    );

    return result;
  } catch (error) {
    console.error("Database Error in getUserCarts:", error);
    throw new Error("Failed to get user carts.");
  }
}

export const createPaymentSessionForAppointment = async ({ metadata }) => {
  try {
    const line_items = metadata.order_lines.map((line) => ({
      price_data: {
        currency: metadata.currency || "sek",
        product_data: { name: line.name },
        unit_amount: line.unit_amount,
      },
      quantity: line.quantity,
    }));

    const baseUrl = process.env.APP_URL ? (process.env.APP_URL.endsWith('/') ? process.env.APP_URL : `${process.env.APP_URL}/`) : 'https://getzynq.io:4000/';

    return await stripe.checkout.sessions.create({
      mode: "payment",

      // ✅ Apple Pay controlled ONLY from dashboard config
      payment_method_configuration: process.env.PAY_NOW_CONFIGRATION_METHOD,

      // billing_address_collection: "required",
      // phone_number_collection: { enabled: true },

      line_items,
      success_url: `${CLINIC_URL}payment-success/?appointment_id=${metadata.appointment_id}&redirect_url=${metadata.redirect_url}`,
      cancel_url: `${baseUrl}api/payments/cancel?appointment_id=${metadata.appointment_id}&session_id={CHECKOUT_SESSION_ID}&redirect_url=${encodeURIComponent(metadata.cancel_url)}`,

      metadata: {
        appointment_id: metadata.appointment_id,
        payment_flow: "PAY_NOW",
        currency: metadata.currency || "sek",
      },
      payment_intent_data: {
        metadata: {
          appointment_id: metadata.appointment_id,
          payment_flow: "PAY_NOW"
        }
      },
      locale: "auto",
    });
  } catch (error) {
    console.error("Failed to create payment session:", error);
    throw error;
  }
};

// export const createPaymentSessionForAppointment = async ({ metadata }) => {
//   try {

//     const line_items = metadata.order_lines.map((line) => ({
//       price_data: {
//         currency: metadata.currency || "sek",
//         product_data: { name: line.name },
//         unit_amount: line.unit_amount,
//       },
//       quantity: line.quantity,
//     }));

//     return await stripe.checkout.sessions.create({
//       mode: "payment",

//       // SHOW ALL PAYMENT METHODS AUTOMATICALLY
//       payment_method_types: [
//         "card",
//         // "klarna",
//         // "paypal"
//       ],

//       line_items,
//       success_url: `${CLINIC_URL}payment-success/?appointment_id=${metadata.appointment_id}&redirect_url=${metadata.redirect_url}`,
//       cancel_url: `${CLINIC_URL}payment-cancel/?redirect_url=${metadata.cancel_url}`,
//       metadata: { appointment_id: metadata.appointment_id, payment_flow: "PAY_NOW" },
//     });

//   } catch (error) {
//     console.error("Failed to create payment session:", error);
//     throw error;
//   }
// };

const PAY_LATER_Klarna_CONFIGRATION_METHOD = process.env.PAY_LATER_Klarna_CONFIGRATION_METHOD;

export const createPaymentSessionForAppointmentPAYLATERKLARNA = async ({ metadata }) => {
  try {

    const line_items = metadata.order_lines.map((line) => ({
      price_data: {
        currency: metadata.currency || "sek",
        product_data: { name: line.name },
        unit_amount: line.unit_amount,
      },
      quantity: line.quantity,
    }));

    return await stripe.checkout.sessions.create({
      mode: "payment",
      // customer: metadata.stripe_customer_id,
      // payment_method_configuration: PAY_LATER_Klarna_CONFIGRATION_METHOD,
      // SHOW ALL PAYMENT METHODS AUTOMATICALLY
      // payment_method_types: [
      //   "klarna",
      // ],
      payment_method_configuration: "pmc_1SvHocQQ6aAv64PfmGe7G20T",

      line_items,
      // ✅ REQUIRED for Klarna

      billing_address_collection: "required",

      // ✅ Restrict country to Sweden (VERY IMPORTANT)

      shipping_address_collection: {

        allowed_countries: ["SE"],

      },

      // ✅ Ensure email is collected (Klarna needs it)

      customer_creation: "if_required",

      success_url: `${CLINIC_URL}payment-success/?appointment_id=${metadata.appointment_id}&redirect_url=${metadata.redirect_url}`,
      cancel_url: `${process.env.APP_URL ? (process.env.APP_URL.endsWith('/') ? process.env.APP_URL : `${process.env.APP_URL}/`) : 'https://getzynq.io:4000/'}api/payments/cancel?appointment_id=${metadata.appointment_id}&session_id={CHECKOUT_SESSION_ID}&redirect_url=${encodeURIComponent(metadata.cancel_url)}`,
      metadata: { appointment_id: metadata.appointment_id, payment_flow: "PAY_LATER_KLARNA" },
      payment_intent_data: {
        metadata: {
          appointment_id: metadata.appointment_id,
          payment_flow: "PAY_LATER_KLARNA"
        }
      },
    });

  } catch (error) {
    console.error("Failed to create payment session:", error);
    throw error;
  }
};


const PAY_LATER_CONFIGRATION_METHOD = process.env.PAY_LATER_CONFIGRATION_METHOD;

export const createPayLaterSetupSession = async ({ metadata, final_total }) => {
  return await stripe.checkout.sessions.create({
    mode: "payment",
    customer: metadata.stripe_customer_id,
    payment_method_configuration: PAY_LATER_CONFIGRATION_METHOD,
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: "Appointment"
          },
          unit_amount: final_total * 100
        },
        quantity: 1
      }
    ],

    success_url: `${CLINIC_URL}payment-success/?appointment_id=${metadata.appointment_id}&type=PAY_NOW&redirect_url=${metadata.redirect_url}`,
    cancel_url: `${CLINIC_URL}payment-cancel/?type=PAY_NOW&redirect_url=${metadata.redirect_url}`,
    metadata: { appointment_id: metadata.appointment_id, payment_flow: "PAY_LATER" },
  });
};

// --------------------------new functiniolity----------------------karan patel-----------------------//

export const createPayLaterSetupIntent = async ({ user_id, appointment_id }) => {
  const stripeCustomerId = await getOrCreateStripeCustomerId(user_id);
  const setupIntent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: {
      appointment_id,
      payment_flow: "PAY_LATER_CARD"
    }
  });
  return { setup_intent_id: setupIntent.id, client_secret: setupIntent.client_secret };
};

// ------------------------------------end----------------------------------------------//


export const getOrCreateStripeCustomerId = async (user_id) => {
  // Check if user already has a stripe_customer_id in DB
  let [user] = await db.query(
    ` SELECT stripe_customer_id, email, full_name
      FROM tbl_users
      WHERE user_id = ?
    `,
    [user_id]
  );

  if (user?.stripe_customer_id) {
    console.log("User already has a Stripe customer ID", user.stripe_customer_id);
    return user.stripe_customer_id;
  }

  // Create Stripe customer
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.full_name,
    metadata: { user_id },
  });

  console.log("Created Stripe customer", customer,);

  console.log("User  Stripe customer ID", user.stripe_customer_id);

  // Store in DB
  await db.query(
    ` UPDATE tbl_users
      SET stripe_customer_id = ?
      WHERE user_id = ?
    `,
    [customer.id, user_id]
  );

  return customer.id;
};

export const updateAuthorizationSetupIntentIdOfAppointment = async (stripe_setup_intent_id, appointment_id) => {
  try {

    return db.query(
      `UPDATE tbl_appointments SET stripe_setup_intent_id  = ? WHERE appointment_id = ?`,
      [stripe_setup_intent_id, appointment_id]
    );

  } catch (err) {
    console.error("Error in updateAuthorizationStatusOfAppointment:", err);
  }
};


export const verifyStripeWebhook = (rawBody, signature) => {
  try {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      // live    'whsec_qVsee2IzT3SbthcJK4XihvLbg4zdL3Yf'
      process.env.STRIPE_SIGNING_WEBHOOK_SECRET
    );
    return event;
  } catch (err) {
    console.error("Stripe Webhook Verification Failed:", err.message);
    throw new Error(`Webhook Verification Failed: ${err.message}`);
  }
};

export const handleSetupIntentSucceeded = async (setupIntent) => {
  const appointment_id = setupIntent.metadata?.appointment_id;
  if (!appointment_id) {
    console.log("No appointment_id found in SetupIntent metadata");
    return;
  }

  // Save payment method for future off-session charge

  const update = await db.query(
    `UPDATE tbl_appointments SET stripe_payment_method_id = ? WHERE appointment_id = ?`,
    [setupIntent.payment_method, appointment_id]);

  console.log(`SetupIntent succeeded for appointment ${appointment_id}`);
};


export const handlePaymentIntentSucceeded = async (paymentIntent) => {
  const appointment_id = paymentIntent.metadata?.appointment_id;
  if (!appointment_id) {
    console.log("No appointment_id found in PaymentIntent metadata");
    return;
  };

  const [appointment] = await db.query(
    `SELECT user_id FROM tbl_appointments WHERE appointment_id = ?`,
    [appointment_id]
  );
  let [user] = await get_user_by_user_id(appointment.user_id);

  user.role = "USER";

  // Mark appointment as paid
  const update = await db.query(
    `UPDATE tbl_appointments SET payment_status = ?, is_paid = 1 WHERE appointment_id = ?`,
    ["paid", appointment_id]
  );

  await sendNotification({
    userData: user,
    type: "APPOINTMENT",
    type_id: appointment_id,
    notification_type: NOTIFICATION_MESSAGES.payment_success_booking_confirmed,
    receiver_id: appointment.user_id,
    receiver_type: "USER"
  })

  console.log(`PaymentIntent succeeded for appointment ${appointment_id}`);
};


export const handlePaymentIntentFailed = async (paymentIntent) => {
  const appointment_id = paymentIntent.metadata?.appointment_id;
  if (!appointment_id) {
    console.log("No appointment_id found in PaymentIntent metadata");
    return;
  };

  const [appointment] = await db.query(
    `SELECT user_id FROM tbl_appointments WHERE appointment_id = ?`,
    [appointment_id]
  );
  let [user] = await get_user_by_user_id(appointment.user_id);

  user.role = "USER";

  // Mark payment failed and cancel appointment status
  const update = await db.query(
    `UPDATE tbl_appointments SET payment_status = ?, status = 'Cancelled' WHERE appointment_id = ?`,
    ["failed", appointment_id]
  );
  const failureReason =
    paymentIntent?.last_payment_error?.message ||
    'insufficient funds';

  await sendNotification({
    userData: user,
    type: "APPOINTMENT",
    type_id: appointment_id,
    notification_type: NOTIFICATION_MESSAGES.payment_failed_pay_later,
    receiver_id: appointment.user_id,
    receiver_type: "USER",
    params: failureReason,
  });

  console.log(`PaymentIntent failed for appointment ${appointment_id}`);
};

export const processDueAuthorizedAppointments = async () => {
  // Get all appointments with status 'authorized' and due for payment
  const appointments = await db.query(
    `SELECT t.*,u.stripe_customer_id FROM tbl_appointments t JOIN tbl_users u ON t.user_id = u.user_id WHERE t.payment_status = 'authorized' AND t.start_time BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)`
  );

  console.log(`Found ${appointments.length} appointments due for payment`);

  for (const appt of appointments) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: appt.total_price * 100, // Convert to cents
        currency: "sek",
        customer: appt.stripe_customer_id,
        payment_method: appt.stripe_payment_method_id,
        off_session: true, // Important for off-session charges
        confirm: true,     // Immediately attempt the payment
        metadata: { appointment_id: appt.appointment_id },
      });

      // Save PaymentIntent ID in database
      const update = await db.query(
        `UPDATE tbl_appointments SET stripe_payment_intent_id = ? WHERE appointment_id = ?`,
        [paymentIntent.id, appt.appointment_id]
      );

      console.log(`Auto-charge succeeded for appointment ${appt.appointment_id}`);

    } catch (err) {
      console.error(`Auto-charge failed for appointment ${appt.appointment_id}:`, err.message);

      // Mark payment failed in database
      const updateFailed = await db.query(
        `UPDATE tbl_appointments SET payment_status = ? WHERE appointment_id = ?`,
        ["failed", appt.appointment_id]
      );
    }
  }
};

export const handleCheckoutSessionCompleted = async (session) => {
  const appointment_id = session.metadata?.appointment_id;
  const payment_flow = session.metadata?.payment_flow;

  if (!appointment_id) {
    console.log("No appointment_id found in Checkout Session metadata");
    return;
  }

  const [appointment] = await db.query(
    `SELECT user_id FROM tbl_appointments WHERE appointment_id = ?`,
    [appointment_id]
  );

  if (!appointment) {
    console.log(`Appointment ${appointment_id} not found`);
    return;
  }

  if (appointment.payment_timing == "PAY_LATER") {

    // Retrieve SetupIntent ID created by Checkout
    const setupIntentId = session.setup_intent;

    if (!setupIntentId) {
      console.log("No setup_intent found on session");
      return;
    }

    // Fetch SetupIntent to get payment_method
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

    await db.query(
      `UPDATE tbl_appointments 
     SET stripe_payment_method_id = ?, stripe_setup_intent_id = ? , payment_status = 'authorized'
     WHERE appointment_id = ?`,
      [setupIntent.payment_method, setupIntent.id, appointment_id]
    );
    console.log(`✅ Card authorized for appointment ${appointment_id}`);
  } else {
    await appointmentModel.updateAppointmentAsPaid(appointment_id, 'paid');
  }

  await sendAppointmentConfirmationNotifications(appointment_id, appointment.user_id);

  console.log(`✅ Payment succeeded for appointment ${appointment_id}`);

};

// utils/appointmentNotifications.js or in your existing utils file

