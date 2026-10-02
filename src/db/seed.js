import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/db.js';

export async function runSeed() {
  console.log('--- Starting Seed Data Insertion for jb_tracker ---');

  try {
    await withTransaction(async (client) => {
      // 1. Check or Clean
      console.log('Clearing existing data for a fresh seed...');
      await client.query(`
        TRUNCATE users, company_settings, partners, partner_investments, partner_withdrawals,
                 categories, products, customers, suppliers, orders, order_items,
                 customer_payments, supplier_payments, expenses, cash_transactions, audit_logs
        CASCADE;
      `);

      // 2. Company Settings
      console.log('Seeding company settings...');
      await client.query(`
        INSERT INTO company_settings (company_name, business_name, currency, timezone, financial_year_start)
        VALUES ('Just Business Things', 'Just Business Things', 'INR', 'Asia/Kolkata', '04-01');
      `);

      // 3. Users
      console.log('Seeding users...');
      const adminPass = await bcrypt.hash('Admin@12345', 10);
      const managerPass = await bcrypt.hash('Manager@12345', 10);
      const staffPass = await bcrypt.hash('Staff@12345', 10);

      const userRes = await client.query(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES 
          ('Admin Founder', 'admin@justbusinessthings.com', $1, 'ADMIN'),
          ('Operations Manager', 'manager@justbusinessthings.com', $2, 'MANAGER'),
          ('Sales Executive', 'staff@justbusinessthings.com', $3, 'STAFF')
        RETURNING id, name, role;
      `, [adminPass, managerPass, staffPass]);
      const adminId = userRes.rows[0].id;

      // 4. Partners
      console.log('Seeding partners...');
      const partnerRes = await client.query(`
        INSERT INTO partners (name, email, phone, ownership_percentage, profit_share_percentage, status)
        VALUES 
          ('Partner A', 'partner.a@justbusinessthings.com', '+91 98765 43210', 50.00, 50.00, 'ACTIVE'),
          ('Partner B', 'partner.b@justbusinessthings.com', '+91 98765 43211', 50.00, 50.00, 'ACTIVE')
        RETURNING id, name;
      `);
      const partnerA = partnerRes.rows[0].id;
      const partnerB = partnerRes.rows[1].id;

      // 5. Partner Investments
      console.log('Seeding partner investments...');
      const invA1 = await client.query(`
        INSERT INTO partner_investments (partner_id, amount, investment_date, investment_type, payment_method, description, reference)
        VALUES ($1, 25000.00, '2026-04-01', 'INITIAL', 'BANK_TRANSFER', 'Founding initial capital contribution', 'UTR-INIT-001')
        RETURNING id;
      `, [partnerA]);

      const invB1 = await client.query(`
        INSERT INTO partner_investments (partner_id, amount, investment_date, investment_type, payment_method, description, reference)
        VALUES ($1, 25000.00, '2026-04-01', 'INITIAL', 'BANK_TRANSFER', 'Founding initial capital contribution', 'UTR-INIT-002')
        RETURNING id;
      `, [partnerB]);

      const invA2 = await client.query(`
        INSERT INTO partner_investments (partner_id, amount, investment_date, investment_type, payment_method, description, reference)
        VALUES ($1, 10000.00, '2026-06-15', 'ADDITIONAL', 'BANK_TRANSFER', 'Working capital expansion infusion', 'UTR-ADD-003')
        RETURNING id;
      `, [partnerA]);

      // Record Cash Transactions for investments
      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES 
          ('MONEY_IN', 'PARTNER_INVESTMENT', $1, 25000.00, '2026-04-01', 'BANK_TRANSFER', 'Initial capital from Partner A'),
          ('MONEY_IN', 'PARTNER_INVESTMENT', $2, 25000.00, '2026-04-01', 'BANK_TRANSFER', 'Initial capital from Partner B'),
          ('MONEY_IN', 'PARTNER_INVESTMENT', $3, 10000.00, '2026-06-15', 'BANK_TRANSFER', 'Additional capital from Partner A');
      `, [invA1.rows[0].id, invB1.rows[0].id, invA2.rows[0].id]);

      // 6. Partner Withdrawals
      console.log('Seeding partner withdrawal...');
      const withA = await client.query(`
        INSERT INTO partner_withdrawals (partner_id, amount, withdrawal_date, payment_method, reason, description)
        VALUES ($1, 5000.00, '2026-08-10', 'BANK_TRANSFER', 'Personal draw', 'Partner personal draw against equity')
        RETURNING id;
      `, [partnerA]);

      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES ('MONEY_OUT', 'PARTNER_WITHDRAWAL', $1, 5000.00, '2026-08-10', 'BANK_TRANSFER', 'Partner A personal withdrawal');
      `, [withA.rows[0].id]);

      // 7. Categories
      console.log('Seeding categories...');
      const catRes = await client.query(`
        INSERT INTO categories (name, description)
        VALUES 
          ('Clothing', 'Corporate t-shirts, uniforms, hoodies, and wearable apparel'),
          ('Corporate Merchandise', 'Branded gifts, tech accessories, water bottles, and stationery'),
          ('Employee Onboarding Kits', 'Curated welcome kits for new hires'),
          ('Restaurant Opening Kits', 'Custom aprons, signage, menus, and front-of-house supplies'),
          ('Event Supplies', 'Badges, banners, backdrops, and conference collateral'),
          ('Awards & Recognition', 'Crystal trophies, plaques, certificates, and medals'),
          ('Packaging Supplies', 'Custom mailer boxes, tape, courier bags, and tissue wrapping'),
          ('Office Supplies', 'Desk organizers, notebooks, pens, and paper requirements'),
          ('School & College Supplies', 'ID cards, notebooks, lab coats, and uniform ties'),
          ('Hotel Supplies', 'Toiletry packaging, door hangers, and room amenities'),
          ('Custom Products', 'Tailored OEM and custom fabricated business solutions'),
          ('Other', 'Miscellaneous B2B requests')
        RETURNING id, name;
      `);
      const catMap = {};
      catRes.rows.forEach(r => { catMap[r.name] = r.id; });

      // 8. Suppliers
      console.log('Seeding suppliers...');
      const supRes = await client.query(`
        INSERT INTO suppliers (supplier_code, company_name, contact_person, email, phone, address, gst_number)
        VALUES 
          ('SUP-0001', 'Tirupur Garments Hub', 'Murugan S.', 'murugan@tirupurgarments.in', '+91 94433 11220', 'Tirupur, Tamil Nadu', '33AAACT1234D1Z2'),
          ('SUP-0002', 'PrintCraft Packaging & Print', 'Vikram Joshi', 'vikram@printcraftmumbai.in', '+91 98200 44556', 'Lower Parel, Mumbai', '27AABCP5678E1Z9'),
          ('SUP-0003', 'Zenith Mementos & Awards', 'Deepak Gupta', 'zenith@awardsdelhi.in', '+91 98110 99887', 'Kirti Nagar, New Delhi', '07AAACZ9876F1Z1'),
          ('SUP-0004', 'EcoPack India Solutions', 'Meenakshi Sundaram', 'sales@ecopack.co.in', '+91 99001 88776', 'Peenya Industrial Area, Bengaluru', '29AADCE5432G1Z7'),
          ('SUP-0005', 'Metro Corporate Gifts Supplies', 'Ankit Mehta', 'ankit@metrogifts.in', '+91 98790 33221', 'Ahmedabad, Gujarat', '24AAACM1357H1Z5')
        RETURNING id, supplier_code;
      `);
      const supMap = {};
      supRes.rows.forEach(r => { supMap[r.supplier_code] = r.id; });

      // 9. Customers
      console.log('Seeding customers...');
      const cusRes = await client.query(`
        INSERT INTO customers (customer_code, company_name, contact_person, email, phone, address, gst_number)
        VALUES 
          ('CUS-0001', 'Apex Global Technologies', 'Rajesh Sharma', 'rajesh.sharma@apextech.in', '+91 98101 22334', 'Cyber City, Gurugram, Haryana', '06AABCA1234F1Z5'),
          ('CUS-0002', 'Blue Horizon Hospitality', 'Priya Nair', 'priya.nair@bluehorizon.com', '+91 98450 66778', 'Indiranagar, Bengaluru, Karnataka', '29AADCB2234G1Z8'),
          ('CUS-0003', 'Spice Symphony Restaurants', 'Amit Verma', 'amit.v@spicesymphony.in', '+91 98220 99881', 'Bandra West, Mumbai, Maharashtra', '27AABCS3344H1Z2'),
          ('CUS-0004', 'Greenfield International School', 'Sunita Rao', 'admin@greenfield.edu.in', '+91 98490 55443', 'Gachibowli, Hyderabad, Telangana', '36AAATG4455J1Z3'),
          ('CUS-0005', 'Nova Retail Brands', 'Karan Malhotra', 'karan@novaretail.com', '+91 99100 88990', 'Connaught Place, New Delhi', '07AAACN5566K1Z9')
        RETURNING id, customer_code;
      `);
      const cusMap = {};
      cusRes.rows.forEach(r => { cusMap[r.customer_code] = r.id; });

      // 10. Products
      console.log('Seeding products...');
      const prodRes = await client.query(`
        INSERT INTO products (category_id, name, description, sku, unit, default_selling_price, default_cost_price)
        VALUES 
          ($1, 'Corporate T-Shirt', '100% Bio-washed combed cotton 180 GSM, screen printed', 'CLO-TSH-001', 'pcs', 399.00, 220.00),
          ($1, 'Polo T-Shirt', 'Pique knit 220 GSM with custom chest embroidery', 'CLO-POL-002', 'pcs', 549.00, 320.00),
          ($1, 'Premium Hoodie', 'Fleece warm hoodie 320 GSM with kangaroo pocket', 'CLO-HOD-003', 'pcs', 1199.00, 750.00),
          ($1, 'Embroidered Cap', 'Structured 6-panel twill cap with metal buckle', 'CLO-CAP-004', 'pcs', 249.00, 130.00),
          ($2, 'Executive Welcome Kit', 'Box containing diary, metal pen, 500ml steel bottle, card holder', 'ONB-EXC-005', 'kit', 1850.00, 1100.00),
          ($3, 'Hardcover Custom Notebook', 'A5 PU leather finish, 192 ruled pages, debossed logo', 'OFF-NOT-006', 'pcs', 299.00, 140.00),
          ($2, 'Insulated Steel Water Bottle', 'Double wall vacuum insulated 750ml, laser engraved', 'MER-BOT-007', 'pcs', 499.00, 260.00),
          ($4, 'Heavy Duty Restaurant Apron', 'Stain-resistant poly-cotton with leather straps', 'RST-APR-008', 'pcs', 450.00, 210.00),
          ($5, 'Crystal Recognition Trophy', 'Optical crystal trophy with UV color printing & wooden base', 'AWR-TRP-009', 'pcs', 1450.00, 780.00),
          ($6, 'Corrugated Custom Packaging Box', '3-ply micro-flute branded mailer box with exterior print', 'PKG-BOX-010', 'pcs', 45.00, 22.00)
        RETURNING id, sku;
      `, [
        catMap['Clothing'],
        catMap['Employee Onboarding Kits'],
        catMap['Office Supplies'],
        catMap['Restaurant Opening Kits'],
        catMap['Awards & Recognition'],
        catMap['Packaging Supplies']
      ]);
      const prodMap = {};
      prodRes.rows.forEach(r => { prodMap[r.sku] = r.id; });

      // 11. Orders & Order Items
      console.log('Seeding orders and order items...');
      
      // Order 1: Apex Global - Delivered, Fully Paid
      // Sales: 300 * 399 = 1,19,700. Cost: 300 * 270 = 81,000. Profit: 38,700
      const ord1 = await client.query(`
        INSERT INTO orders (order_number, customer_id, category_id, order_date, expected_delivery_date, status, subtotal, discount, tax, total_amount, total_cost, gross_profit, notes, created_by)
        VALUES ('JB-000001', $1, $2, '2026-05-02', '2026-05-16', 'DELIVERED', 119700.00, 0.00, 0.00, 119700.00, 81000.00, 38700.00, 'Annual team meet corporate t-shirts', $3)
        RETURNING id;
      `, [cusMap['CUS-0001'], catMap['Clothing'], adminId]);

      await client.query(`
        INSERT INTO order_items (order_id, product_id, description, quantity, unit_selling_price, unit_cost_price, discount, tax, total_selling_amount, total_cost_amount, profit, supplier_id)
        VALUES ($1, $2, 'Corporate T-Shirt - Black, Sizes M/L/XL', 300, 399.00, 270.00, 0.00, 0.00, 119700.00, 81000.00, 38700.00, $3);
      `, [ord1.rows[0].id, prodMap['CLO-TSH-001'], supMap['SUP-0001']]);

      // Customer payments for Order 1
      const pay1 = await client.query(`
        INSERT INTO customer_payments (customer_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES 
          ($1, $2, 60000.00, '2026-05-03', 'BANK_TRANSFER', 'NEFT-APEX-ADV', '50% advance payment', $3),
          ($1, $2, 59700.00, '2026-05-18', 'BANK_TRANSFER', 'NEFT-APEX-BAL', 'Balance payment upon delivery', $3)
        RETURNING id, amount, payment_date;
      `, [cusMap['CUS-0001'], ord1.rows[0].id, adminId]);

      // Supplier payments for Order 1
      const spay1 = await client.query(`
        INSERT INTO supplier_payments (supplier_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES ($1, $2, 81000.00, '2026-05-10', 'BANK_TRANSFER', 'UTR-TIRUPUR-01', 'Direct procurement payment', $3)
        RETURNING id, amount, payment_date;
      `, [supMap['SUP-0001'], ord1.rows[0].id, adminId]);

      // Cash entries for Order 1
      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES 
          ('MONEY_IN', 'CUSTOMER_PAYMENT', $1, 60000.00, '2026-05-03', 'BANK_TRANSFER', 'Customer payment JB-000001 (Advance) - Apex Global'),
          ('MONEY_IN', 'CUSTOMER_PAYMENT', $2, 59700.00, '2026-05-18', 'BANK_TRANSFER', 'Customer payment JB-000001 (Balance) - Apex Global'),
          ('MONEY_OUT', 'SUPPLIER_PAYMENT', $3, 81000.00, '2026-05-10', 'BANK_TRANSFER', 'Supplier payment JB-000001 - Tirupur Garments');
      `, [pay1.rows[0].id, pay1.rows[1].id, spay1.rows[0].id]);

      // Order 2: Blue Horizon Hospitality - Confirmed, Partial Payment Received
      // Kits: 50 * 1850 = 92,500. Cost: 50 * 1100 = 55,000. Profit: 37,500
      const ord2 = await client.query(`
        INSERT INTO orders (order_number, customer_id, category_id, order_date, expected_delivery_date, status, subtotal, discount, tax, total_amount, total_cost, gross_profit, notes, created_by)
        VALUES ('JB-000002', $1, $2, '2026-06-05', '2026-06-25', 'READY', 92500.00, 0.00, 0.00, 92500.00, 55000.00, 37500.00, 'New management onboarding welcome kits', $3)
        RETURNING id;
      `, [cusMap['CUS-0002'], catMap['Employee Onboarding Kits'], adminId]);

      await client.query(`
        INSERT INTO order_items (order_id, product_id, description, quantity, unit_selling_price, unit_cost_price, discount, tax, total_selling_amount, total_cost_amount, profit, supplier_id)
        VALUES ($1, $2, 'Executive Welcome Kit with engraved flasks', 50, 1850.00, 1100.00, 0.00, 0.00, 92500.00, 55000.00, 37500.00, $3);
      `, [ord2.rows[0].id, prodMap['ONB-EXC-005'], supMap['SUP-0005']]);

      // Customer paid 50,000; Balance receivable: 42,500
      const pay2 = await client.query(`
        INSERT INTO customer_payments (customer_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES ($1, $2, 50000.00, '2026-06-06', 'BANK_TRANSFER', 'BH-UPI-778', 'Initial advance 50k', $3)
        RETURNING id;
      `, [cusMap['CUS-0002'], ord2.rows[0].id, adminId]);

      // Supplier paid 35,000; Balance payable to supplier: 20,000
      const spay2 = await client.query(`
        INSERT INTO supplier_payments (supplier_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES ($1, $2, 35000.00, '2026-06-12', 'BANK_TRANSFER', 'METRO-ADV-12', 'Procurement advance', $3)
        RETURNING id;
      `, [supMap['SUP-0005'], ord2.rows[0].id, adminId]);

      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES 
          ('MONEY_IN', 'CUSTOMER_PAYMENT', $1, 50000.00, '2026-06-06', 'BANK_TRANSFER', 'Customer payment JB-000002 - Blue Horizon'),
          ('MONEY_OUT', 'SUPPLIER_PAYMENT', $2, 35000.00, '2026-06-12', 'BANK_TRANSFER', 'Supplier payment JB-000002 - Metro Corporate Gifts');
      `, [pay2.rows[0].id, spay2.rows[0].id]);

      // Order 3: Spice Symphony - Custom Aprons & Packaging
      // 100 Aprons @ 450 = 45,000 (Cost 21,000)
      // 500 Boxes @ 45 = 22,500 (Cost 11,000)
      // Total: 67,500. Total Cost: 32,000. Profit: 35,500
      const ord3 = await client.query(`
        INSERT INTO orders (order_number, customer_id, category_id, order_date, expected_delivery_date, status, subtotal, discount, tax, total_amount, total_cost, gross_profit, notes, created_by)
        VALUES ('JB-000003', $1, $2, '2026-07-01', '2026-07-20', 'DELIVERED', 67500.00, 0.00, 0.00, 67500.00, 32000.00, 35500.00, 'Bistro opening kit and takeout boxes', $3)
        RETURNING id;
      `, [cusMap['CUS-0003'], catMap['Restaurant Opening Kits'], adminId]);

      await client.query(`
        INSERT INTO order_items (order_id, product_id, description, quantity, unit_selling_price, unit_cost_price, discount, tax, total_selling_amount, total_cost_amount, profit, supplier_id)
        VALUES 
          ($1, $2, 'Heavy Duty Restaurant Apron - Black with logo', 100, 450.00, 210.00, 0.00, 0.00, 45000.00, 21000.00, 24000.00, $3),
          ($1, $4, 'Corrugated Branded Delivery Boxes', 500, 45.00, 22.00, 0.00, 0.00, 22500.00, 11000.00, 11500.00, $5);
      `, [ord3.rows[0].id, prodMap['RST-APR-008'], supMap['SUP-0001'], prodMap['PKG-BOX-010'], supMap['SUP-0004']]);

      // Paid in full
      const pay3 = await client.query(`
        INSERT INTO customer_payments (customer_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES ($1, $2, 67500.00, '2026-07-15', 'UPI', 'UPI-SPICE-9901', 'Full payment via UPI', $3)
        RETURNING id;
      `, [cusMap['CUS-0003'], ord3.rows[0].id, adminId]);

      const spay3_1 = await client.query(`
        INSERT INTO supplier_payments (supplier_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES ($1, $2, 21000.00, '2026-07-08', 'BANK_TRANSFER', 'UTR-TIR-APR', 'Apron procurement', $3)
        RETURNING id;
      `, [supMap['SUP-0001'], ord3.rows[0].id, adminId]);

      const spay3_2 = await client.query(`
        INSERT INTO supplier_payments (supplier_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES ($1, $2, 11000.00, '2026-07-10', 'BANK_TRANSFER', 'UTR-ECO-BOX', 'Box packaging procurement', $3)
        RETURNING id;
      `, [supMap['SUP-0004'], ord3.rows[0].id, adminId]);

      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES 
          ('MONEY_IN', 'CUSTOMER_PAYMENT', $1, 67500.00, '2026-07-15', 'UPI', 'Payment JB-000003 - Spice Symphony'),
          ('MONEY_OUT', 'SUPPLIER_PAYMENT', $2, 21000.00, '2026-07-08', 'BANK_TRANSFER', 'Supplier payment JB-000003 - Tirupur Garments'),
          ('MONEY_OUT', 'SUPPLIER_PAYMENT', $3, 11000.00, '2026-07-10', 'BANK_TRANSFER', 'Supplier payment JB-000003 - EcoPack India');
      `, [pay3.rows[0].id, spay3_1.rows[0].id, spay3_2.rows[0].id]);

      // Order 4: Greenfield School - Awards & Trophies
      // 40 Trophies @ 1450 = 58,000 (Cost 40 * 780 = 31,200). Profit: 26,800
      const ord4 = await client.query(`
        INSERT INTO orders (order_number, customer_id, category_id, order_date, expected_delivery_date, status, subtotal, discount, tax, total_amount, total_cost, gross_profit, notes, created_by)
        VALUES ('JB-000004', $1, $2, '2026-08-01', '2026-08-28', 'DELIVERED', 58000.00, 0.00, 0.00, 58000.00, 31200.00, 26800.00, 'Annual Sports Day & Academic Excellence Awards', $3)
        RETURNING id;
      `, [cusMap['CUS-0004'], catMap['Awards & Recognition'], adminId]);

      await client.query(`
        INSERT INTO order_items (order_id, product_id, description, quantity, unit_selling_price, unit_cost_price, discount, tax, total_selling_amount, total_cost_amount, profit, supplier_id)
        VALUES ($1, $2, 'Crystal Optical Trophies custom etched', 40, 1450.00, 780.00, 0.00, 0.00, 58000.00, 31200.00, 26800.00, $3);
      `, [ord4.rows[0].id, prodMap['AWR-TRP-009'], supMap['SUP-0003']]);

      // Customer payment: 30,000; Balance receivable: 28,000
      const pay4 = await client.query(`
        INSERT INTO customer_payments (customer_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES ($1, $2, 30000.00, '2026-08-05', 'BANK_TRANSFER', 'RTGS-GREEN-01', 'Advance payment 30k', $3)
        RETURNING id;
      `, [cusMap['CUS-0004'], ord4.rows[0].id, adminId]);

      const spay4 = await client.query(`
        INSERT INTO supplier_payments (supplier_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES ($1, $2, 31200.00, '2026-08-14', 'BANK_TRANSFER', 'UTR-ZENITH-AWR', 'Zenith full payment', $3)
        RETURNING id;
      `, [supMap['SUP-0003'], ord4.rows[0].id, adminId]);

      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES 
          ('MONEY_IN', 'CUSTOMER_PAYMENT', $1, 30000.00, '2026-08-05', 'BANK_TRANSFER', 'Payment JB-000004 - Greenfield School'),
          ('MONEY_OUT', 'SUPPLIER_PAYMENT', $2, 31200.00, '2026-08-14', 'BANK_TRANSFER', 'Supplier payment JB-000004 - Zenith Awards');
      `, [pay4.rows[0].id, spay4.rows[0].id]);

      // Order 5: Nova Retail - Hoodies & Caps (Procurement status)
      // 150 Hoodies @ 1199 = 1,79,850. Cost: 150 * 750 = 1,12,500. Profit: 67,350
      const ord5 = await client.query(`
        INSERT INTO orders (order_number, customer_id, category_id, order_date, expected_delivery_date, status, subtotal, discount, tax, total_amount, total_cost, gross_profit, notes, created_by)
        VALUES ('JB-000005', $1, $2, '2026-08-20', '2026-09-15', 'PROCUREMENT', 179850.00, 0.00, 0.00, 179850.00, 112500.00, 67350.00, 'Winter retail staff apparel', $3)
        RETURNING id;
      `, [cusMap['CUS-0005'], catMap['Clothing'], adminId]);

      await client.query(`
        INSERT INTO order_items (order_id, product_id, description, quantity, unit_selling_price, unit_cost_price, discount, tax, total_selling_amount, total_cost_amount, profit, supplier_id)
        VALUES ($1, $2, 'Premium Hoodie Navy Blue custom branded', 150, 1199.00, 750.00, 0.00, 0.00, 179850.00, 112500.00, 67350.00, $3);
      `, [ord5.rows[0].id, prodMap['CLO-HOD-003'], supMap['SUP-0001']]);

      // Nova paid 90,000 advance
      const pay5 = await client.query(`
        INSERT INTO customer_payments (customer_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES ($1, $2, 90000.00, '2026-08-22', 'BANK_TRANSFER', 'NEFT-NOVA-ADV', '50% advance payment', $3)
        RETURNING id;
      `, [cusMap['CUS-0005'], ord5.rows[0].id, adminId]);

      // Paid supplier 60,000 advance
      const spay5 = await client.query(`
        INSERT INTO supplier_payments (supplier_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by)
        VALUES ($1, $2, 60000.00, '2026-08-25', 'BANK_TRANSFER', 'UTR-TIR-HOD', 'Fabric & knitting advance', $3)
        RETURNING id;
      `, [supMap['SUP-0001'], ord5.rows[0].id, adminId]);

      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES 
          ('MONEY_IN', 'CUSTOMER_PAYMENT', $1, 90000.00, '2026-08-22', 'BANK_TRANSFER', 'Payment JB-000005 - Nova Retail'),
          ('MONEY_OUT', 'SUPPLIER_PAYMENT', $2, 60000.00, '2026-08-25', 'BANK_TRANSFER', 'Supplier payment JB-000005 - Tirupur Garments');
      `, [pay5.rows[0].id, spay5.rows[0].id]);

      // Order 6: Low Margin Order (To test Low Margin Warning: 4.8% margin)
      // Apex Global - Water Bottles: 100 * 250 = 25,000. Cost: 100 * 238 = 23,800. Profit = 1,200 (Margin: 4.8%)
      const ord6 = await client.query(`
        INSERT INTO orders (order_number, customer_id, category_id, order_date, expected_delivery_date, status, subtotal, discount, tax, total_amount, total_cost, gross_profit, notes, created_by)
        VALUES ('JB-000006', $1, $2, '2026-09-02', '2026-09-20', 'CUSTOMIZATION', 25000.00, 0.00, 0.00, 25000.00, 23800.00, 1200.00, 'Clearance volume promotion - Low margin order', $3)
        RETURNING id;
      `, [cusMap['CUS-0001'], catMap['Corporate Merchandise'], adminId]);

      await client.query(`
        INSERT INTO order_items (order_id, product_id, description, quantity, unit_selling_price, unit_cost_price, discount, tax, total_selling_amount, total_cost_amount, profit, supplier_id)
        VALUES ($1, $2, 'Insulated Water Bottles - Special Volume Quote', 100, 250.00, 238.00, 0.00, 0.00, 25000.00, 23800.00, 1200.00, $3);
      `, [ord6.rows[0].id, prodMap['MER-BOT-007'], supMap['SUP-0005']]);

      // Order 7: Negative Margin / Loss Making Order (To test Loss-Making Alert: Selling 20,000, Cost 22,000 = -2,000)
      const ord7 = await client.query(`
        INSERT INTO orders (order_number, customer_id, category_id, order_date, expected_delivery_date, status, subtotal, discount, tax, total_amount, total_cost, gross_profit, notes, created_by)
        VALUES ('JB-000007', $1, $2, '2026-09-10', '2026-09-28', 'CONFIRMED', 20000.00, 0.00, 0.00, 20000.00, 22000.00, -2000.00, 'Goodwill replacement batch with freight surcharge absorbed', $3)
        RETURNING id;
      `, [cusMap['CUS-0002'], catMap['Office Supplies'], adminId]);

      await client.query(`
        INSERT INTO order_items (order_id, product_id, description, quantity, unit_selling_price, unit_cost_price, discount, tax, total_selling_amount, total_cost_amount, profit, supplier_id)
        VALUES ($1, $2, 'Hardcover Custom Notebooks emergency expedite batch', 100, 200.00, 220.00, 0.00, 0.00, 20000.00, 22000.00, -2000.00, $3);
      `, [ord7.rows[0].id, prodMap['OFF-NOT-006'], supMap['SUP-0002']]);

      // Order 8, 9, 10
      const ord8 = await client.query(`
        INSERT INTO orders (order_number, customer_id, category_id, order_date, expected_delivery_date, status, subtotal, discount, tax, total_amount, total_cost, gross_profit, notes, created_by)
        VALUES ('JB-000008', $1, $2, '2026-09-12', '2026-10-05', 'CONFIRMED', 38430.00, 0.00, 0.00, 38430.00, 22400.00, 16030.00, 'Custom embroidered caps for sports meet', $3)
        RETURNING id;
      `, [cusMap['CUS-0004'], catMap['Clothing'], adminId]);

      await client.query(`
        INSERT INTO order_items (order_id, product_id, description, quantity, unit_selling_price, unit_cost_price, discount, tax, total_selling_amount, total_cost_amount, profit, supplier_id)
        VALUES ($1, $2, 'Embroidered Cap - Red/White Team Edition', 154, 249.54, 145.45, 0.00, 0.00, 38430.00, 22400.00, 16030.00, $3);
      `, [ord8.rows[0].id, prodMap['CLO-CAP-004'], supMap['SUP-0001']]);

      const ord9 = await client.query(`
        INSERT INTO orders (order_number, customer_id, category_id, order_date, expected_delivery_date, status, subtotal, discount, tax, total_amount, total_cost, gross_profit, notes, created_by)
        VALUES ('JB-000009', $1, $2, '2026-09-18', '2026-10-10', 'DRAFT', 45000.00, 0.00, 0.00, 45000.00, 26000.00, 19000.00, 'Draft quotation for festive gifting', $3)
        RETURNING id;
      `, [cusMap['CUS-0005'], catMap['Corporate Merchandise'], adminId]);

      const ord10 = await client.query(`
        INSERT INTO orders (order_number, customer_id, category_id, order_date, expected_delivery_date, status, subtotal, discount, tax, total_amount, total_cost, gross_profit, notes, created_by)
        VALUES ('JB-000010', $1, $2, '2026-09-22', '2026-09-30', 'CANCELLED', 15000.00, 0.00, 0.00, 15000.00, 9500.00, 5500.00, 'Client postponed corporate event indefinitely', $3)
        RETURNING id;
      `, [cusMap['CUS-0003'], catMap['Restaurant Opening Kits'], adminId]);

      // 12. Operating Expenses
      console.log('Seeding operating expenses...');
      const exp1 = await client.query(`
        INSERT INTO expenses (expense_number, category, description, amount, expense_date, payment_method, receipt_reference, created_by)
        VALUES ('EXP-000001', 'Advertising', 'Google & Meta Performance Ads Campaign Q1', 12500.00, '2026-05-15', 'CARD', 'INV-META-2026-05', $1)
        RETURNING id;
      `, [adminId]);

      const exp2 = await client.query(`
        INSERT INTO expenses (expense_number, category, description, amount, expense_date, payment_method, receipt_reference, created_by)
        VALUES ('EXP-000002', 'Software', 'Google Workspace, Accounting & Design SaaS subscriptions', 4200.00, '2026-06-01', 'CARD', 'SUB-GW-JUNE', $1)
        RETURNING id;
      `, [adminId]);

      const exp3 = await client.query(`
        INSERT INTO expenses (expense_number, category, description, amount, expense_date, payment_method, receipt_reference, created_by)
        VALUES ('EXP-000003', 'Courier', 'Sample prototypes express air shipping charges', 3450.00, '2026-06-20', 'UPI', 'DTDC-AWB-99881', $1)
        RETURNING id;
      `, [adminId]);

      const exp4 = await client.query(`
        INSERT INTO expenses (expense_number, category, description, amount, expense_date, payment_method, receipt_reference, created_by)
        VALUES ('EXP-000004', 'Travel', 'Client visit flights and local transit to Bengaluru', 8900.00, '2026-07-22', 'CARD', 'IXIGO-AIR-7721', $1)
        RETURNING id;
      `, [adminId]);

      const exp5 = await client.query(`
        INSERT INTO expenses (expense_number, category, description, amount, expense_date, payment_method, receipt_reference, created_by)
        VALUES ('EXP-000005', 'Office', 'Co-working shared flexi desks monthly fee', 12000.00, '2026-08-01', 'BANK_TRANSFER', 'WEWORK-AUG-332', $1)
        RETURNING id;
      `, [adminId]);

      // Record cash transactions for expenses
      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES 
          ('MONEY_OUT', 'BUSINESS_EXPENSE', $1, 12500.00, '2026-05-15', 'CARD', 'Expense EXP-000001: Advertising campaign'),
          ('MONEY_OUT', 'BUSINESS_EXPENSE', $2, 4200.00, '2026-06-01', 'CARD', 'Expense EXP-000002: Software subscriptions'),
          ('MONEY_OUT', 'BUSINESS_EXPENSE', $3, 3450.00, '2026-06-20', 'UPI', 'Expense EXP-000003: Courier shipments'),
          ('MONEY_OUT', 'BUSINESS_EXPENSE', $4, 8900.00, '2026-07-22', 'CARD', 'Expense EXP-000004: Travel'),
          ('MONEY_OUT', 'BUSINESS_EXPENSE', $5, 12000.00, '2026-08-01', 'BANK_TRANSFER', 'Expense EXP-000005: Office space');
      `, [exp1.rows[0].id, exp2.rows[0].id, exp3.rows[0].id, exp4.rows[0].id, exp5.rows[0].id]);

      // 13. Audit logs
      console.log('Seeding initial audit logs...');
      await client.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
        VALUES 
          ($1, 'INIT_SYSTEM', 'COMPANY', (SELECT id FROM company_settings LIMIT 1), '{"event": "System initialized"}'),
          ($1, 'INVESTMENT_RECORDED', 'PARTNER_INVESTMENT', $2, '{"partner": "Partner A", "amount": 25000}'),
          ($1, 'INVESTMENT_RECORDED', 'PARTNER_INVESTMENT', $3, '{"partner": "Partner B", "amount": 25000}'),
          ($1, 'ORDER_CREATED', 'ORDER', $4, '{"order_number": "JB-000001", "total": 119700}');
      `, [adminId, invA1.rows[0].id, invB1.rows[0].id, ord1.rows[0].id]);
    });

    console.log('✓ Seed completed successfully with realistic business data!');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    await pool.end();
    process.exit(1);
  }
}

runSeed();
