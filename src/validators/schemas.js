import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const customerSchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  contact_person: z.string().optional().nullable(),
  email: z.string().email('Invalid email address').optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  gst_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

export const supplierSchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  contact_person: z.string().optional().nullable(),
  email: z.string().email('Invalid email address').optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  gst_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

export const categorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  description: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});

export const productSchema = z.object({
  category_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1, 'Product name is required'),
  description: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  unit: z.string().default('pcs'),
  default_selling_price: z.coerce.number().min(0, 'Selling price must be 0 or greater'),
  default_cost_price: z.coerce.number().min(0, 'Cost price must be 0 or greater'),
  is_active: z.boolean().default(true),
});

export const orderItemSchema = z.object({
  product_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1, 'Item description is required'),
  quantity: z.coerce.number().positive('Quantity must be greater than 0'),
  unit_selling_price: z.coerce.number().min(0, 'Selling price must be >= 0'),
  unit_cost_price: z.coerce.number().min(0, 'Cost price must be >= 0'),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  supplier_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const orderCreateSchema = z.object({
  customer_id: z.string().uuid('Customer is required'),
  category_id: z.string().uuid().optional().nullable(),
  order_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  expected_delivery_date: z.string().optional().nullable(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED', 'CANCELLED']).default('CONFIRMED'),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  notes: z.string().optional().nullable(),
  items: z.array(orderItemSchema).min(1, 'Order must contain at least one item'),
});

export const orderUpdateSchema = z.object({
  status: z.enum(['DRAFT', 'CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED', 'CANCELLED']).optional(),
  category_id: z.string().uuid().optional().nullable(),
  expected_delivery_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  discount: z.coerce.number().min(0).optional(),
  tax: z.coerce.number().min(0).optional(),
});

export const customerPaymentSchema = z.object({
  customer_id: z.string().uuid('Customer is required'),
  order_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  payment_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  payment_method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'OTHER']),
  reference_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const supplierPaymentSchema = z.object({
  supplier_id: z.string().uuid('Supplier is required'),
  order_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  payment_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  payment_method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'OTHER']),
  reference_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const expenseSchema = z.object({
  category: z.string().min(1, 'Category is required'),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  expense_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  payment_method: z.string().default('BANK_TRANSFER'),
  supplier_id: z.string().uuid().optional().nullable(),
  order_id: z.string().uuid().optional().nullable(),
  receipt_reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const partnerSchema = z.object({
  name: z.string().min(1, 'Partner name is required'),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  ownership_percentage: z.coerce.number().min(0).max(100),
  profit_share_percentage: z.coerce.number().min(0).max(100),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

export const partnerInvestmentSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  investment_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  investment_type: z.enum(['INITIAL', 'ADDITIONAL']),
  payment_method: z.string().default('BANK_TRANSFER'),
  description: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
});

export const partnerWithdrawalSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  withdrawal_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  payment_method: z.string().default('BANK_TRANSFER'),
  reason: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

export const companySettingsSchema = z.object({
  company_name: z.string().min(1),
  business_name: z.string().min(1),
  currency: z.string().min(1).default('INR'),
  timezone: z.string().min(1).default('Asia/Kolkata'),
  financial_year_start: z.string().min(1).default('04-01'),
});

export const userCreateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['ADMIN', 'MANAGER', 'STAFF']).default('STAFF'),
});
