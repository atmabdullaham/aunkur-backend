require('dotenv').config({ path: '.env' });
const axios = require('axios');

(async () => {
  console.log('BULKSMS_API_KEY exists?', Boolean(process.env.BULKSMS_API_KEY));
  console.log('BULKSMS_SENDERID exists?', Boolean(process.env.BULKSMS_SENDERID), process.env.BULKSMS_SENDERID);
  
  try {
    const res = await axios.get("http://bulksmsbd.net/api/getBalanceApi", {
      params: { api_key: process.env.BULKSMS_API_KEY },
      timeout: 6000,
    });
    console.log('Balance API response:', res.data);
  } catch (err) {
    console.error('Balance API error:', err.message);
  }
})().catch(console.error);

