import axios from 'axios';

const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_ORG_ID = process.env.ZOHO_ORG_ID;

let accessToken: string | null = null;

// Helper to get Access Token
const getAccessToken = async () => {
    try {
        console.log('[ZohoService] Requesting new access token...');
        console.log('[ZohoService] Refresh Token:', ZOHO_REFRESH_TOKEN ? 'Set (length: ' + ZOHO_REFRESH_TOKEN.length + ')' : 'NOT SET');

        const url = `https://accounts.zoho.in/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
        const response = await axios.post(url);

        console.log('[ZohoService] Token response:', JSON.stringify(response.data, null, 2));

        if (response.data.access_token) {
            accessToken = response.data.access_token;
            console.log('[ZohoService] Access Token refreshed successfully');
            return accessToken;
        } else {
            console.error('[ZohoService] No access_token in response:', response.data);
            throw new Error('No access token in response');
        }
    } catch (error: any) {
        console.error('[ZohoService] Error refreshing token:');
        console.error('  Error message:', error.message);
        console.error('  Response data:', error.response?.data);
        console.error('  Response status:', error.response?.status);
        throw error;
    }
};

export const fetchNextPONumber = async (): Promise<string> => {
    // Keeping this mocked for now as per previous agreement, or can be updated later
    const timestamp = Date.now().toString().slice(-6);
    return `PO/VEAPL/2526/${timestamp}`;
};

export const getPODetails = async (poNumber: string) => {
    console.log(`[ZohoService] Fetching details for PO: ${poNumber}`);
    console.log(`[ZohoService] Using Org ID: ${ZOHO_ORG_ID}`);

    try {
        // Get access token
        if (!accessToken) {
            console.log('[ZohoService] No access token, fetching new one...');
            await getAccessToken();
        }

        // 1. Search for PO by Number to get ID
        const searchUrl = `https://www.zohoapis.in/inventory/v1/purchaseorders?organization_id=${ZOHO_ORG_ID}&purchaseorder_number_contains=${poNumber}`;
        console.log(`[ZohoService] Search URL: ${searchUrl}`);

        let response = await axios.get(searchUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });

        console.log(`[ZohoService] Search response code: ${response.data.code}`);
        console.log(`[ZohoService] Search response:`, JSON.stringify(response.data, null, 2));

        // Retry once if token expired
        if (response.data.code === 57) { // Invalid Token Code
            console.log('[ZohoService] Token expired, refreshing...');
            await getAccessToken();
            response = await axios.get(searchUrl, {
                headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
            });
            console.log(`[ZohoService] Retry response:`, JSON.stringify(response.data, null, 2));
        }

        const purchaseOrders = response.data.purchaseorders;
        if (!purchaseOrders || purchaseOrders.length === 0) {
            console.error('[ZohoService] No purchase orders found in response');
            throw new Error('Purchase Order not found in Zoho');
        }

        console.log(`[ZohoService] Found ${purchaseOrders.length} PO(s)`);

        // 2. Get Full Details using PO ID
        const poId = purchaseOrders[0].purchaseorder_id;
        console.log(`[ZohoService] Fetching details for PO ID: ${poId}`);

        const detailUrl = `https://www.zohoapis.in/inventory/v1/purchaseorders/${poId}?organization_id=${ZOHO_ORG_ID}`;

        const detailResponse = await axios.get(detailUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });

        console.log(`[ZohoService] Detail response received`);
        const zohoPO = detailResponse.data.purchaseorder;

        // 3. Map to our format
        return {
            po_number: zohoPO.purchaseorder_number,
            date: zohoPO.date,
            vendor: {
                name: zohoPO.vendor_name,
                address: zohoPO.billing_address ? zohoPO.billing_address.address : '',
                gstin: zohoPO.gst_no || '',
                email: zohoPO.vendor_email || '',
                phone: zohoPO.vendor_phone || ''
            },
            items: zohoPO.line_items.map((item: any) => ({
                item_name: item.name,
                description: item.description,
                vepl_part_no: item.sku,
                mpn: item.sku,
                ordered_qty: item.quantity,
                unit_price: item.rate,
                tax_rate: item.tax_percentage,
                hsn_sac: item.hsn_or_sac
            }))
        };

    } catch (error: any) {
        console.error('[ZohoService] ERROR Details:');
        console.error('  Message:', error.message);
        console.error('  Response Status:', error.response?.status);
        console.error('  Response Data:', JSON.stringify(error.response?.data, null, 2));
        console.error('  Full Error:', error);
        throw new Error('Failed to fetch PO from Zoho');
    }
};
