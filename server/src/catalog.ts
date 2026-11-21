// SIMULATED CATALOG DATA — prices, stock and specs are demo values, not live retailer data.

export type Category = 'earbuds' | 'headphones' | 'smartwatch' | 'speaker' | 'accessory';

export interface SeedProduct {
  id: string;
  name: string;
  brand: string;
  category: Category;
  price: number; // INR
  mrp: number;
  rating: number;
  reviews: number;
  stock: number;
  highlights: string[];
  specs: Record<string, string | number | boolean>;
}

export const SEED_PRODUCTS: SeedProduct[] = [
  // ---------- Earbuds ----------
  {
    id: 'EB-101', name: 'Airdopes 141 Pro', brand: 'boAt', category: 'earbuds', price: 1299, mrp: 3990,
    rating: 4.1, reviews: 18230, stock: 42,
    highlights: ['42h total playback', 'ENx noise reduction for calls', 'Beast Mode low latency'],
    specs: { battery_hours: 42, anc: false, driver_mm: 8, bluetooth: '5.3', water_resistance: 'IPX4', latency_ms: 60, fast_charge: '10 min = 75 min', sound_score: 7 },
  },
  {
    id: 'EB-102', name: 'Buds VS104 Max', brand: 'Noise', category: 'earbuds', price: 1799, mrp: 4999,
    rating: 4.2, reviews: 9120, stock: 25,
    highlights: ['50h total playback', '32dB hybrid ANC', 'Quad mic ENC'],
    specs: { battery_hours: 50, anc: true, driver_mm: 13, bluetooth: '5.3', water_resistance: 'IPX5', latency_ms: 50, fast_charge: '10 min = 150 min', sound_score: 7.5 },
  },
  {
    id: 'EB-103', name: 'Nord Buds 3', brand: 'OnePlus', category: 'earbuds', price: 2299, mrp: 2999,
    rating: 4.4, reviews: 12650, stock: 18,
    highlights: ['43h total playback', '32dB ANC', '12.4mm bass drivers'],
    specs: { battery_hours: 43, anc: true, driver_mm: 12.4, bluetooth: '5.4', water_resistance: 'IP55', latency_ms: 94, fast_charge: '10 min = 11 h', sound_score: 8.5 },
  },
  {
    id: 'EB-104', name: 'Wave Beam Lite', brand: 'JBL', category: 'earbuds', price: 2799, mrp: 4999,
    rating: 4.3, reviews: 4310, stock: 9,
    highlights: ['JBL Deep Bass sound', '32h total playback', 'Smart Ambient mode'],
    specs: { battery_hours: 32, anc: false, driver_mm: 8, bluetooth: '5.2', water_resistance: 'IP54', latency_ms: 120, fast_charge: '10 min = 2 h', sound_score: 9 },
  },
  {
    id: 'EB-105', name: 'Buds 2a', brand: 'CMF by Nothing', category: 'earbuds', price: 2499, mrp: 3499,
    rating: 4.3, reviews: 3870, stock: 0,
    highlights: ['42dB ANC', '35.5h total playback', 'Dirac tuned'],
    specs: { battery_hours: 35.5, anc: true, driver_mm: 12.4, bluetooth: '5.3', water_resistance: 'IP54', latency_ms: 80, fast_charge: '10 min = 5 h', sound_score: 8 },
  },
  {
    id: 'EB-106', name: 'Rockerz Buds 70H', brand: 'boAt', category: 'earbuds', price: 1599, mrp: 4490,
    rating: 4.0, reviews: 6025, stock: 60,
    highlights: ['70h mega battery', 'ENx call clarity', 'ASAP fast charge'],
    specs: { battery_hours: 70, anc: false, driver_mm: 10, bluetooth: '5.3', water_resistance: 'IPX5', latency_ms: 65, fast_charge: '10 min = 180 min', sound_score: 6.5 },
  },
  {
    id: 'EB-107', name: 'Galaxy Buds FE', brand: 'Samsung', category: 'earbuds', price: 5499, mrp: 9999,
    rating: 4.4, reviews: 7020, stock: 14,
    highlights: ['Active Noise Cancellation', 'AKG-style rich sound', 'Galaxy ecosystem'],
    specs: { battery_hours: 21, anc: true, driver_mm: 12, bluetooth: '5.2', water_resistance: 'IPX2', latency_ms: 110, fast_charge: 'n/a', sound_score: 8.8 },
  },
  // ---------- Headphones ----------
  {
    id: 'HP-201', name: 'Rockerz 550', brand: 'boAt', category: 'headphones', price: 1799, mrp: 4999,
    rating: 4.1, reviews: 52110, stock: 33,
    highlights: ['20h playback', '50mm drivers', 'Soft padded ear cushions'],
    specs: { battery_hours: 20, anc: false, driver_mm: 50, bluetooth: '5.0', foldable: true, sound_score: 7, weight_g: 220 },
  },
  {
    id: 'HP-202', name: 'Tune 770NC', brand: 'JBL', category: 'headphones', price: 6999, mrp: 9999,
    rating: 4.4, reviews: 3890, stock: 12,
    highlights: ['Adaptive ANC', '70h playback', 'JBL Pure Bass'],
    specs: { battery_hours: 70, anc: true, driver_mm: 40, bluetooth: '5.3', foldable: true, sound_score: 8.7, weight_g: 232 },
  },
  {
    id: 'HP-203', name: 'WH-CH720N', brand: 'Sony', category: 'headphones', price: 8990, mrp: 14990,
    rating: 4.5, reviews: 8210, stock: 7,
    highlights: ['Dual-chip ANC', '35h playback', 'Lightest Sony ANC headphone'],
    specs: { battery_hours: 35, anc: true, driver_mm: 30, bluetooth: '5.2', foldable: false, sound_score: 9, weight_g: 192 },
  },
  {
    id: 'HP-204', name: 'Headphone (1)', brand: 'Nothing', category: 'headphones', price: 21999, mrp: 24999,
    rating: 4.5, reviews: 1150, stock: 5,
    highlights: ['KEF tuned sound', 'Adaptive ANC', '80h playback (ANC off)'],
    specs: { battery_hours: 80, anc: true, driver_mm: 40, bluetooth: '5.3', foldable: false, sound_score: 9.4, weight_g: 329 },
  },
  {
    id: 'HP-205', name: 'Two 2.0', brand: 'Noise', category: 'headphones', price: 1499, mrp: 3999,
    rating: 3.9, reviews: 7400, stock: 48,
    highlights: ['50h playback', 'Dual pairing', 'Low latency mode'],
    specs: { battery_hours: 50, anc: false, driver_mm: 40, bluetooth: '5.3', foldable: true, sound_score: 6.8, weight_g: 180 },
  },
  {
    id: 'HP-206', name: 'H390 USB Headset', brand: 'Logitech', category: 'headphones', price: 2295, mrp: 2995,
    rating: 4.3, reviews: 14200, stock: 26,
    highlights: ['Noise-cancelling boom mic', 'Plug-and-play USB', 'In-line mute & volume'],
    specs: { wireless: false, anc: false, driver_mm: 30, connection: 'USB-A wired', foldable: false, sound_score: 6.5, weight_g: 197 },
  },
  {
    id: 'HP-207', name: 'WH-CH520', brand: 'Sony', category: 'headphones', price: 3990, mrp: 5990,
    rating: 4.3, reviews: 9650, stock: 21,
    highlights: ['50h battery', 'Lightweight 147 g', 'Multipoint connection'],
    specs: { battery_hours: 50, wireless: true, anc: false, driver_mm: 30, bluetooth: '5.2', foldable: false, sound_score: 7.8, weight_g: 147 },
  },
  {
    id: 'HP-208', name: 'Q Over-Ear', brand: 'Boult', category: 'headphones', price: 1299, mrp: 4999,
    rating: 3.8, reviews: 3100, stock: 40,
    highlights: ['70h playback', '40mm bass drivers', 'Gaming low-latency mode'],
    specs: { battery_hours: 70, wireless: true, anc: false, driver_mm: 40, bluetooth: '5.4', foldable: true, latency_ms: 45, sound_score: 6.6, weight_g: 210 },
  },
  {
    id: 'HP-209', name: 'Evolve2 30 SE', brand: 'Jabra', category: 'headphones', price: 4999, mrp: 6499,
    rating: 4.5, reviews: 2380, stock: 8,
    highlights: ['2-mic call technology', 'Certified for Teams & Zoom', 'Busylight indicator'],
    specs: { wireless: false, anc: false, driver_mm: 28, connection: 'USB-C wired', foldable: false, sound_score: 7.4, weight_g: 125 },
  },
  {
    id: 'HP-210', name: 'Zone Vibe 100', brand: 'Logitech', category: 'headphones', price: 8995, mrp: 10995,
    rating: 4.4, reviews: 1890, stock: 0,
    highlights: ['Noise-cancelling flip mic', '20h wireless', 'Multipoint'],
    specs: { battery_hours: 20, wireless: true, anc: false, driver_mm: 40, bluetooth: '5.2', foldable: false, sound_score: 7.6, weight_g: 185 },
  },
  // ---------- Smartwatches ----------
  {
    id: 'SW-301', name: 'ColorFit Pro 6', brand: 'Noise', category: 'smartwatch', price: 3999, mrp: 6999,
    rating: 4.1, reviews: 5320, stock: 20,
    highlights: ['1.96" AMOLED', 'Bluetooth calling', '7-day battery'],
    specs: { battery_days: 7, display: '1.96" AMOLED', calling: true, gps: false, water_resistance: 'IP68', sensors: 'HR, SpO2, Stress' },
  },
  {
    id: 'SW-302', name: 'Wave Sigma 3', brand: 'boAt', category: 'smartwatch', price: 1299, mrp: 7990,
    rating: 3.9, reviews: 21980, stock: 75,
    highlights: ['2.01" HD display', 'BT calling', 'Crest+ OS'],
    specs: { battery_days: 7, display: '2.01" HD', calling: true, gps: false, water_resistance: 'IP67', sensors: 'HR, SpO2' },
  },
  {
    id: 'SW-303', name: 'Watch Pro 2', brand: 'CMF by Nothing', category: 'smartwatch', price: 4999, mrp: 5999,
    rating: 4.3, reviews: 2410, stock: 11,
    highlights: ['Interchangeable bezels', 'Built-in GPS', '11-day battery'],
    specs: { battery_days: 11, display: '1.32" AMOLED', calling: true, gps: true, water_resistance: 'IP68', sensors: 'HR, SpO2, Stress, Sleep' },
  },
  {
    id: 'SW-304', name: 'Watch Fit 3', brand: 'Huawei', category: 'smartwatch', price: 9999, mrp: 13999,
    rating: 4.5, reviews: 1980, stock: 6,
    highlights: ['1.82" AMOLED', '10-day battery', '100+ workout modes'],
    specs: { battery_days: 10, display: '1.82" AMOLED', calling: true, gps: true, water_resistance: '5ATM', sensors: 'HR, SpO2, Stress, Sleep' },
  },
  {
    id: 'SW-305', name: 'Galaxy Watch FE', brand: 'Samsung', category: 'smartwatch', price: 14999, mrp: 19999,
    rating: 4.4, reviews: 3120, stock: 9,
    highlights: ['Wear OS', 'BioActive sensor', 'Sapphire crystal glass'],
    specs: { battery_days: 1.5, display: '1.2" Super AMOLED', calling: false, gps: true, water_resistance: '5ATM + IP68', sensors: 'HR, ECG, BIA, SpO2' },
  },
  // ---------- Speakers ----------
  {
    id: 'SP-401', name: 'Stone 352', brand: 'boAt', category: 'speaker', price: 1499, mrp: 3990,
    rating: 4.2, reviews: 30210, stock: 40,
    highlights: ['10W output', '12h playback', 'IPX7 waterproof'],
    specs: { output_w: 10, battery_hours: 12, water_resistance: 'IPX7', bluetooth: '5.0', tws_pairing: true, sound_score: 7 },
  },
  {
    id: 'SP-402', name: 'Flip 6', brand: 'JBL', category: 'speaker', price: 9999, mrp: 13999,
    rating: 4.6, reviews: 11250, stock: 10,
    highlights: ['Racetrack woofer + tweeter', '12h playback', 'IP67 dust & waterproof'],
    specs: { output_w: 30, battery_hours: 12, water_resistance: 'IP67', bluetooth: '5.1', tws_pairing: true, sound_score: 9.2 },
  },
  {
    id: 'SP-403', name: 'SRS-XB100', brand: 'Sony', category: 'speaker', price: 4490, mrp: 5990,
    rating: 4.4, reviews: 4870, stock: 16,
    highlights: ['Extra Bass', '16h playback', 'Built-in strap'],
    specs: { output_w: 5, battery_hours: 16, water_resistance: 'IP67', bluetooth: '5.3', tws_pairing: true, sound_score: 8 },
  },
  {
    id: 'SP-404', name: 'Zeb-Sound Feast 500', brand: 'Zebronics', category: 'speaker', price: 2999, mrp: 5999,
    rating: 4.0, reviews: 2210, stock: 22,
    highlights: ['70W party speaker', 'RGB lights', 'Karaoke mic input'],
    specs: { output_w: 70, battery_hours: 6, water_resistance: 'none', bluetooth: '5.0', tws_pairing: true, sound_score: 7.5 },
  },
  // ---------- Mobile accessories ----------
  {
    id: 'AC-501', name: '20000mAh Power Bank 22.5W', brand: 'Ambrane', category: 'accessory', price: 1399, mrp: 2999,
    rating: 4.2, reviews: 41020, stock: 55,
    highlights: ['22.5W fast charging', 'Type-C PD in/out', 'Charges 3 devices'],
    specs: { capacity_mah: 20000, output_w: 22.5, ports: '2x USB-A, 1x Type-C', weight_g: 410 },
  },
  {
    id: 'AC-502', name: '65W GaN Charger', brand: 'Portronics', category: 'accessory', price: 1899, mrp: 3999,
    rating: 4.3, reviews: 3800, stock: 30,
    highlights: ['65W GaN fast charge', 'Laptop + phone', 'Dual Type-C'],
    specs: { output_w: 65, ports: '2x Type-C, 1x USB-A', gan: true, weight_g: 120 },
  },
  {
    id: 'AC-503', name: 'Braided Type-C to Type-C Cable 1.5m', brand: 'Anker', category: 'accessory', price: 799, mrp: 1499,
    rating: 4.5, reviews: 15300, stock: 120,
    highlights: ['100W PD support', 'Nylon braided', '1.5 m length'],
    specs: { length_m: 1.5, max_power_w: 100, braided: true },
  },
  {
    id: 'AC-504', name: 'MagSafe-style Magnetic Wireless Charger', brand: 'Spigen', category: 'accessory', price: 2499, mrp: 3999,
    rating: 4.2, reviews: 1760, stock: 0,
    highlights: ['15W magnetic charging', 'Aluminium body', 'Strong alignment'],
    specs: { output_w: 15, magnetic: true, cable: 'Type-C 1 m' },
  },
];

/**
 * Call / comfort attributes for audio products (SIMULATED editorial scores out of 10, used by the
 * deal scorer and the devil's-advocate critic). multipoint = connects to laptop + phone at once.
 */
const AUDIO_EXTRAS: Record<string, { mic_score: number; comfort_score: number; multipoint: boolean }> = {
  'EB-101': { mic_score: 6.5, comfort_score: 7, multipoint: false },
  'EB-102': { mic_score: 7.5, comfort_score: 7, multipoint: true },
  'EB-103': { mic_score: 7.5, comfort_score: 8, multipoint: true },
  'EB-104': { mic_score: 6, comfort_score: 8, multipoint: false },
  'EB-105': { mic_score: 7, comfort_score: 7.5, multipoint: true },
  'EB-106': { mic_score: 6, comfort_score: 6.5, multipoint: false },
  'EB-107': { mic_score: 8, comfort_score: 8.5, multipoint: false },
  'HP-201': { mic_score: 5, comfort_score: 7, multipoint: false },
  'HP-202': { mic_score: 7.5, comfort_score: 8, multipoint: true },
  'HP-203': { mic_score: 7.5, comfort_score: 9, multipoint: true },
  'HP-204': { mic_score: 8, comfort_score: 7.5, multipoint: true },
  'HP-205': { mic_score: 5.5, comfort_score: 6, multipoint: true },
  'HP-206': { mic_score: 8.5, comfort_score: 7, multipoint: false },
  'HP-207': { mic_score: 6.5, comfort_score: 8.5, multipoint: true },
  'HP-208': { mic_score: 4.5, comfort_score: 6, multipoint: false },
  'HP-209': { mic_score: 9.5, comfort_score: 8.5, multipoint: false },
  'HP-210': { mic_score: 9, comfort_score: 8.5, multipoint: true },
};
for (const p of SEED_PRODUCTS) {
  const x = AUDIO_EXTRAS[p.id];
  if (x) p.specs = { ...p.specs, ...x, wireless: p.specs.wireless ?? true };
}

export const COUPONS = {
  WELCOME10: { code: 'WELCOME10', description: '10% off, maximum ₹500 discount', type: 'percent', value: 10, maxDiscount: 500, minOrder: 0 },
  SAVE200: { code: 'SAVE200', description: '₹200 off on orders above ₹2,000', type: 'flat', value: 200, maxDiscount: 200, minOrder: 2000 },
} as const;

export type CouponCode = keyof typeof COUPONS;
