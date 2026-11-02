import { Request, Response } from 'express';
import pool from '../config/db';
import { fetchNextPONumber } from '../services/zohoService';
import axios from 'axios';

// Fetch PO Details from Zoho (Auto-Detect Org)
export const getZohoPO = async (req: Request, res: Response) => {
    try {
        const { poNumber } = req.params;

        if (!poNumber) {
            res.status(400).json({ error: 'PO Number is required' });
            return;
        }

        // Trim PO Number to handle leading/trailing spaces (e.g. from copy-paste)
        const poNumberTrimmed = poNumber.trim();
        console.log(`[Controller] Fetching PO: '${poNumberTrimmed}'`);

        // List of Organizations to check
        const allOrgs = [
            {
                id: process.env.ZOHO_ORG_ID_VISPL,
                name: 'VISPL',
                refreshToken: process.env.ZOHO_REFRESH_TOKEN, // Default/VISPL token
                apiBase: 'https://www.zohoapis.in/inventory/v1' // Inventory API
            },
            {
                id: process.env.ZOHO_ORG_ID_VEAPL,
                name: 'VEAPL',
                refreshToken: process.env.ZOHO_REFRESH_TOKEN_VEAPL || process.env.ZOHO_REFRESH_TOKEN, // Use VEAPL specific or fallback
                apiBase: 'https://www.zohoapis.in/books/v3' // Books API
            }
        ];

        // Filter based on user selection if provided
        const { org } = req.query;
        const orgsToCheck = org
            ? allOrgs.filter(o => o.name === org)
            : allOrgs;

        if (orgsToCheck.length === 0) {
            res.status(400).json({ error: 'Invalid Organization selected' });
            return;
        }

        let foundPO = null;
        let foundOrgId = null;
        let foundAccessToken = null;
        let foundApiBase = null;
        let foundOrgName = null;

        for (const org of orgsToCheck) {
            if (!org.id) continue;

            console.log(`[Controller] Checking Org: ${org.name} (${org.id})`);

            let accessToken = null;

            // 1. Get Access Token
            try {
                const tokenUrl = `https://accounts.zoho.in/oauth/v2/token?refresh_token=${org.refreshToken}&client_id=${process.env.ZOHO_CLIENT_ID}&client_secret=${process.env.ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
                const tokenResponse = await axios.post(tokenUrl);
                accessToken = tokenResponse.data.access_token;
            } catch (tokenErr: any) {
                console.error(`[Controller] Token Fetch Failed for ${org.name}:`, tokenErr.response?.data || tokenErr.message);
                continue; // Skip to next org if token fails
            }

            // 2. Search PO
            try {
                const searchUrl = `${org.apiBase}/purchaseorders?organization_id=${org.id}&purchaseorder_number_contains=${encodeURIComponent(poNumberTrimmed)}`;
                console.log(`[Controller] Searching URL: ${searchUrl}`);

                const searchResponse = await axios.get(searchUrl, {
                    headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
                });

                const purchaseOrders = searchResponse.data.purchaseorders;
                console.log(`[Controller] Search Response for ${org.name}: Found ${purchaseOrders ? purchaseOrders.length : 0} POs`);

                if (purchaseOrders && purchaseOrders.length > 0) {
                    console.log(`[Controller] Found PO in ${org.name}: ${purchaseOrders[0].purchaseorder_number}`);
                    foundPO = purchaseOrders[0];
                    foundOrgId = org.id;
                    foundAccessToken = accessToken;
                    foundApiBase = org.apiBase;
                    foundOrgName = org.name;
                    break; // Stop searching if found
                } else {
                    console.log(`[Controller] PO not found in ${org.name}`);
                }
            } catch (searchErr: any) {
                console.error(`[Controller] Search Failed in ${org.name}:`, searchErr.response?.data || searchErr.message);
                // Continue to next org
            }
        }

        if (!foundPO || !foundOrgId || !foundAccessToken || !foundApiBase) {
            console.log('[Controller] PO not found in any configured organization');
            res.status(404).json({ error: 'Purchase Order not found in Zoho (checked VISPL & VEAPL)' });
            return;
        }

        // Get full details using the Org ID where it was found
        const poId = foundPO.purchaseorder_id;
        console.log(`[Controller] Fetching details for PO ID: ${poId}`);

        const detailUrl = `${foundApiBase}/purchaseorders/${poId}?organization_id=${foundOrgId}`;
        const detailResponse = await axios.get(detailUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${foundAccessToken}` }
        });

        const zohoPO = detailResponse.data.purchaseorder;
        console.log(`[Controller] Raw Zoho PO retrieved. Vendor: ${zohoPO.vendor_name}`);

        // Fetch existing PO from DB to preserve local data (like Location)
        const existingPOCheck = await pool.query(
            `SELECT poi.item_name, mi.vepl_part_no, poi.location 
             FROM purchase_orders po
             JOIN purchase_order_items poi ON po.id = poi.po_id
             LEFT JOIN master_items mi ON poi.item_id = mi.id
             WHERE po.po_number = $1`,
            [zohoPO.purchaseorder_number]
        );

        const existingLocationMap = new Map();
        existingPOCheck.rows.forEach((row: any) => {
            if (row.location) {
                if (row.item_name) existingLocationMap.set(row.item_name, row.location);
                if (row.vepl_part_no) existingLocationMap.set(row.vepl_part_no, row.location);
            }
        });

        // Map to our format
        const poDetails = {
            po_number: zohoPO.purchaseorder_number,
            organization: foundOrgName,
            date: zohoPO.date,
            total: zohoPO.total,
            sub_total: zohoPO.sub_total,
            tax_total: zohoPO.tax_total,
            adjustment: zohoPO.adjustment,
            vendor: {
                name: zohoPO.vendor_name,
                address: zohoPO.billing_address ? zohoPO.billing_address.address : '',
                gstin: zohoPO.gst_no || '',
                email: zohoPO.vendor_email || '',
                phone: zohoPO.vendor_phone || ''
            },
            items: zohoPO.line_items.map((item: any) => {
                try {
                    // Parse MPN and MFR from description
                    const description = item.description || '';

                    // Regex patterns for MPN and Manufacturer
                    // Matches "MPN: <value>" or "MPN : <value>" case insensitive
                    const mpnMatch = description.match(/MPN\s*[:]\s*([^\n,]+)/i);

                    // Matches "Mfr: <value>" or "Manufacturer: <value>" case insensitive
                    const mfrMatch = description.match(/(?:Mfr|Manufacturer)\s*[:]\s*([^\n,]+)/i);

                    // Check for existing location
                    const savedLocation = existingLocationMap.get(item.name) || existingLocationMap.get(item.sku);

                    return {
                        item_name: item.name,
                        sku: item.sku || '', // Ensure string
                        description: description,
                        vepl_part_no: item.sku || '', // Ensure string
                        mpn: mpnMatch ? mpnMatch[1].trim() : '', // Extracted MPN
                        ordered_qty: item.quantity,
                        unit_price: item.rate,
                        tax_rate: item.tax_percentage,
                        hsn_sac: item.hsn_or_sac,
                        mfr: mfrMatch ? mfrMatch[1].trim() : (item.manufacturer || ''), // Extracted MFR or fallback
                        location: savedLocation || '' // Preserve location
                    };
                } catch (mapErr) {
                    console.error(`[Controller] Error mapping item ${item.name}:`, mapErr);
                    throw mapErr;
                }
            })
        };

        console.log(`[Controller] Successfully fetched PO details. Auto-saving...`);

        // Auto-save to DB
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const savedPoId = await savePOToDB(client, poDetails);
            await client.query('COMMIT');
            console.log(`[Controller] Auto-saved PO with ID: ${savedPoId}`);

            // Return response with saved ID
            res.json({ ...poDetails, id: savedPoId });
        } catch (saveError) {
            await client.query('ROLLBACK');
            console.error('[Controller] Auto-save failed:', saveError);
            // Still return the fetched details even if save fails, but maybe warn?
            // For now, let's return the details but log the error.
            res.json(poDetails);
        } finally {
            client.release();
        }
    } catch (error: any) {
        console.error('Error fetching Zoho PO:', error);
        if (error.response) {
            console.error('Zoho Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        res.status(500).json({ error: 'Failed to fetch PO details', details: error.message });
    }
};

// Get All Saved Purchase Orders
export const getAllPurchaseOrders = async (req: Request, res: Response) => {
    try {
        const poResult = await pool.query(`
            SELECT po.*, v.name as vendor_name, v.address as vendor_address, v.gstin as vendor_gstin, v.email as vendor_email, v.phone as vendor_phone 
            FROM purchase_orders po
            LEFT JOIN vendors v ON po.vendor_id = v.id
            ORDER BY po.date DESC
        `);

        const purchaseOrders = [];

        for (const po of poResult.rows) {
            const itemsResult = await pool.query(`
                SELECT poi.*, mi.vepl_part_no, mi.mpn, mi.manufacturer as mfr
                FROM purchase_order_items poi
                LEFT JOIN master_items mi ON poi.item_id = mi.id
                WHERE poi.po_id = $1
            `, [po.id]);

            purchaseOrders.push({
                po_number: po.po_number,
                organization: po.organization,
                date: po.date,
                vendor: {
                    name: po.vendor_name,
                    address: po.vendor_address,
                    gstin: po.vendor_gstin,
                    email: po.vendor_email,
                    phone: po.vendor_phone
                },
                items: itemsResult.rows.map(item => ({
                    item_name: item.item_name,
                    description: item.description,
                    vepl_part_no: item.vepl_part_no,
                    mpn: item.mpn,
                    ordered_qty: item.ordered_qty,
                    unit_price: item.unit_price,
                    tax_rate: item.tax_rate,
                    location: item.location,
                    mfr: item.mfr,
                    sku: item.vepl_part_no // Assuming SKU is VEPL Part No for now
                })),
                total: parseFloat(po.grand_total),
                sub_total: parseFloat(po.total_amount),
                tax_total: parseFloat(po.tax_amount),
                adjustment: 0 // Not stored in DB currently
            });
        }

        res.json(purchaseOrders);
    } catch (error) {
        console.error('Error fetching all POs:', error);
        res.status(500).json({ error: 'Failed to fetch purchase orders' });
    }
};
// Helper function to save PO to DB
const savePOToDB = async (client: any, poData: any) => {
    const { date, vendor, items, po_number: providedPONumber, organization } = poData;
    const po_number = providedPONumber.trim();

    // 1. Handle Vendor (Find or Create)
    let vendor_id;
    const vendorCheck = await client.query('SELECT id FROM vendors WHERE name = $1', [vendor.name]);

    if (vendorCheck.rows.length > 0) {
        vendor_id = vendorCheck.rows[0].id;
    } else {
        const newVendor = await client.query(
            'INSERT INTO vendors (name, address, gstin, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [vendor.name, vendor.address, vendor.gstin, vendor.email, vendor.phone]
        );
        vendor_id = newVendor.rows[0].id;
    }

    // 2. Handle PO (Insert or Update)
    let poId;
    const poCheck = await client.query('SELECT id FROM purchase_orders WHERE po_number = $1', [po_number]);

    if (poCheck.rows.length > 0) {
        // Update existing PO
        poId = poCheck.rows[0].id;
        await client.query(
            `UPDATE purchase_orders 
             SET date = $1, vendor_id = $2, status = 'Draft', organization = $3
             WHERE id = $4`,
            [date, vendor_id, organization, poId]
        );

        // Clear existing items to replace them
        await client.query('DELETE FROM purchase_order_items WHERE po_id = $1', [poId]);
    } else {
        // Insert new PO
        const poResult = await client.query(
            `INSERT INTO purchase_orders (po_number, date, vendor_id, status, organization) 
             VALUES ($1, $2, $3, 'Draft', $4) RETURNING id`,
            [po_number, date, vendor_id, organization]
        );
        poId = poResult.rows[0].id;
    }

    // 3. Handle Items
    let totalAmount = 0;
    let taxAmount = 0;

    for (const item of items) {
        let { item_id, ordered_qty, unit_price, tax_rate, item_name, description, location, vepl_part_no, mpn, mfr } = item;

        // Handle Item (Find or Create in Master Items)
        if (!item_id) {
            // Try to find by Item Name or VEPL Part No
            const itemCheck = await client.query(
                'SELECT id FROM master_items WHERE item_name = $1 OR vepl_part_no = $2',
                [item_name, vepl_part_no]
            );

            if (itemCheck.rows.length > 0) {
                item_id = itemCheck.rows[0].id;
            } else {
                // Create new Master Item
                const newItem = await client.query(
                    `INSERT INTO master_items (item_name, description, vepl_part_no, mpn, manufacturer, default_unit_price) 
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                    [item_name, description, vepl_part_no, mpn, mfr, unit_price]
                );
                item_id = newItem.rows[0].id;
            }
        }

        await client.query(
            `INSERT INTO purchase_order_items 
             (po_id, item_id, item_name, description, ordered_qty, unit_price, tax_rate, location) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [poId, item_id, item_name, description, ordered_qty, unit_price, tax_rate, location]
        );

        const lineTotal = ordered_qty * unit_price;
        const lineTax = lineTotal * (tax_rate / 100);

        totalAmount += lineTotal;
        taxAmount += lineTax;
    }

    // 5. Update Totals
    const grandTotal = totalAmount + taxAmount;
    await client.query(
        `UPDATE purchase_orders 
         SET total_amount = $1, tax_amount = $2, grand_total = $3 
         WHERE id = $4`,
        [totalAmount, taxAmount, grandTotal, poId]
    );

    return poId;
};

// Create or Update Purchase Order
export const createPurchaseOrder = async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { date, vendor, items, po_number, organization } = req.body;

        if (!po_number || !vendor || !items || items.length === 0) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        const poId = await savePOToDB(client, req.body);

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Purchase Order saved successfully',
            po_number,
            po_id: poId
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating/updating PO:', error);
        res.status(500).json({ error: 'Failed to save Purchase Order' });
    } finally {
        client.release();
    }
};

// Search Items
export const searchItems = async (req: Request, res: Response) => {
    try {
        const { q } = req.query;
        if (!q) {
            res.status(400).json({ error: 'Query parameter q is required' });
            return;
        }

        const result = await pool.query(
            `SELECT * FROM master_items 
             WHERE item_name ILIKE $1 
             OR vepl_part_no ILIKE $1 
             OR mpn ILIKE $1 
             LIMIT 20`,
            [`%${q}%`]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error searching items:', error);
        res.status(500).json({ error: 'Failed to search items' });
    }
};
