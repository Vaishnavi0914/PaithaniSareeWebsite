/**
 * Seed script to populate the catalog with default Paithani products.
 * Run: node seed-products.js (from backend folder, with MongoDB running)
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const dns = require('dns');
const mongoose = require('mongoose');

const Product = require('./models/Product');

// Prefer public DNS resolvers for MongoDB SRV lookups (avoids local DNS issues).
dns.setServers(['8.8.8.8', '1.1.1.1']);

const catalog = [
  { sku: 'PAI-001', name: 'All Over/Work Paithani', price: 95000, description: 'Heavy all-over work Paithani with rich zari pallu.', image: 'images/All_Over_Work_Paithani.jpg', category: 'Pure Silk Paithani', stock: 4, lowStockThreshold: 1 },
  { sku: 'PAI-002', name: 'Half Border Paithani', price: 40000, description: 'Classic half-border Paithani, perfect for traditional occasions.', image: 'images/Half_Border_Paithani.jpg', category: 'Pure Silk Paithani', stock: 8, lowStockThreshold: 2 },
  { sku: 'PAI-003', name: 'Lotus Broket Paithani', price: 60000, description: 'Intricate lotus broket pattern with pure silk base.', image: 'images/Lotus_Broket_Paithani.jpg', category: 'Pure Silk Paithani', stock: 6, lowStockThreshold: 2 },
  { sku: 'PAI-004', name: 'More Popat Broket Paithani', price: 40000, description: 'Signature More-Popat motif Paithani with vibrant colours.', image: 'images/More_Popat_Broket_Paithani.jpg', category: 'Pure Silk Paithani', stock: 7, lowStockThreshold: 2 },
  { sku: 'PAI-005', name: 'Single Muniya Paithani', price: 30000, description: 'Elegant single muniya border Paithani for subtle royal look.', image: 'images/Single_Muniya_Paithani.jpg', category: 'Pure Silk Paithani', stock: 10, lowStockThreshold: 3 },
  { sku: 'PAI-006', name: 'Rudra Broket Paithani', price: 90000, description: 'Exclusive Rudra broket Paithani from our premium collection.', image: 'images/Rudra_Broket_Paithani.jpg', category: 'Pure Silk Paithani', stock: 3, lowStockThreshold: 1 },
  { sku: 'PAI-007', name: 'Nandini Broket Paithani', price: 100000, description: 'Nandini broket design with detailed handwoven motifs.', image: 'images/Nandini_Broket_Paithani.jpg', category: 'Pure Silk Paithani', stock: 3, lowStockThreshold: 1 },
  { sku: 'PAI-008', name: 'Lili Floral Paithani', price: 75000, description: 'Elegant floral motifs with rich Paithani weave.', image: 'images/Lili_Floral_Paithani.jpg', category: 'Pure Silk Paithani', stock: 5, lowStockThreshold: 2 },
  { sku: 'PAI-009', name: 'All Over Butta with Gonda Pallu Paithani', price: 18000, description: 'Semi silk Paithani with all-over butta and gonda pallu.', image: 'images/All_Over_Butta_with_Gonda_Pallu_Paithani.jpg', category: 'Semi Silk Paithani', stock: 12, lowStockThreshold: 3 },
  { sku: 'PAI-010', name: 'Floral Zari Semi Paithani', price: 19500, description: 'Floral zari work with semi silk base.', image: 'images/Floral_Zari_Semi_Paithani.jpg', category: 'Semi Silk Paithani', stock: 12, lowStockThreshold: 3 },
  { sku: 'PAI-011', name: 'Peacock Motif Semi Paithani', price: 21000, description: 'Peacock motif Paithani in semi silk.', image: 'images/Peacock_Motif_Semi_Paithani.jpg', category: 'Semi Silk Paithani', stock: 12, lowStockThreshold: 3 },
  { sku: 'PAI-012', name: 'Classic Muniya Semi Paithani', price: 20000, description: 'Classic muniya design in semi silk.', image: 'images/Classic_Muniya_Semi_Paithani.jpg', category: 'Semi Silk Paithani', stock: 12, lowStockThreshold: 3 },
  { sku: 'PAI-013', name: 'Paithani Dupatta', price: 18500, description: 'Paithani dupatta for festive styling.', image: 'images/Paithani_Dupatta.jpg', category: 'Paithani Accessories', stock: 10, lowStockThreshold: 2 },
  { sku: 'PAI-014', name: 'Paithani Jacket', price: 14500, description: 'Paithani jacket with traditional detailing.', image: 'images/Paithani_Jacket.jpg', category: 'Paithani Accessories', stock: 8, lowStockThreshold: 2 },
  { sku: 'PAI-015', name: 'Paithani Cap', price: 6200, description: 'Paithani cap accessory.', image: 'images/Paithani_Cap.jpg', category: 'Paithani Accessories', stock: 12, lowStockThreshold: 3 },
  { sku: 'PAI-016', name: 'Paithani Blouse piece', price: 12500, description: 'Paithani blouse piece with zari.', image: 'images/Paithani_Blouse_piece.jpg', category: 'Paithani Accessories', stock: 10, lowStockThreshold: 2 }
];

const mongoUri = (process.env.MONGO_URI || 'mongodb://localhost:27017/paithaniDB')
  .trim()
  .replace(/^['"']|['"']$/g, '');

async function seed() {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const existing = await Product.countDocuments();
    if (existing > 0) {
      console.log(`Database already has ${existing} products. Skipping seed. Use Product.deleteMany() to reset.`);
      process.exit(0);
      return;
    }

    await Product.insertMany(catalog);
    console.log(`Seeded ${catalog.length} products into catalog`);
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
