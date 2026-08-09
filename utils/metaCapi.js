const axios = require("axios");
const crypto = require("crypto");

/**
 * Hash customer data using SHA-256 according to Meta API standard specifications
 */
const hashField = (val) => {
  if (!val) return undefined;
  const clean = val.toString().trim().toLowerCase();
  if (!clean) return undefined;
  return crypto.createHash("sha256").update(clean).digest("hex");
};

/**
 * Format phone number for Meta (e.g. Bangladesh numbers formatted to 8801XXXXXXXXX)
 */
const formatPhone = (phone) => {
  if (!phone) return undefined;
  let clean = phone.toString().replace(/\D/g, "");
  if (clean.startsWith("0")) {
    clean = "88" + clean;
  }
  return hashField(clean);
};

/**
 * Send server-side event to Meta Conversions API (CAPI)
 * @param {Object} params
 * @param {string} params.eventName - Event name e.g. 'CompleteRegistration' or 'Lead'
 * @param {string} params.eventId - Unique event ID for deduplication with client-side pixel
 * @param {Object} params.userData - User info (phone, name, email, clientIp, userAgent)
 * @param {Object} params.customData - Custom parameters (value, currency, transaction_Id)
 * @param {string} params.sourceUrl - Page URL where event occurred
 */
const sendMetaCapiEvent = async ({
  eventName = "CompleteRegistration",
  eventId,
  userData = {},
  customData = {},
  sourceUrl = "https://aunkurctgnorth.org/registration",
}) => {
  const pixelId = process.env.META_DATASET_ID || "1842755366707684";
  const accessToken =
    process.env.META_ACCESS_TOKEN ||
    "EAAWTwfiNDc0BSAo95E5jOhbKgEOzMW4uJKZBZB8ciiLbt96CojPHUtadai58knAV2spHUIn7g4xGx8Jypw3Y0rE8yoU2efoqQeZAlv6MIxH4Tak1Bgz7cHBTKLK5B5fkLFbWMVxz40pc8ZChWPwSh7W3pB58NdtFMag3wSVvjRuWjVzRSYej9OZATn2hPL6o9OwZDZD";

  if (!pixelId || !accessToken) {
    console.warn("⚠️ Meta CAPI: Dataset ID or Access Token is missing.");
    return;
  }

  const fnHash = hashField(userData.firstName || userData.name);
  const phHash = formatPhone(userData.phone);
  const emHash = hashField(userData.email);

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        event_source_url: sourceUrl,
        action_source: "website",
        user_data: {
          ph: phHash ? [phHash] : undefined,
          fn: fnHash ? [fnHash] : undefined,
          em: emHash ? [emHash] : undefined,
          client_ip_address: userData.clientIp || undefined,
          client_user_agent: userData.userAgent || undefined,
        },
        custom_data: {
          currency: "BDT",
          value: 220,
          content_name: "Aunkur Scholarship Application",
          ...customData,
        },
      },
    ],
  };

  try {
    const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`;
    const response = await axios.post(url, payload);
    console.log(`✅ Meta CAPI event '${eventName}' sent successfully. Events received:`, response.data?.events_received);
    return response.data;
  } catch (error) {
    console.error("❌ Meta CAPI error:", error.response?.data || error.message);
  }
};

module.exports = { sendMetaCapiEvent };
