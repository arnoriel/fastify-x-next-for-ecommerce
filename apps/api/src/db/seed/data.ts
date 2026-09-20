// Data statis seed. Pisah dari logika agar mudah diganti per klien baru.
export const categorySeed = [
  { name: "Fashion Pria", slug: "fashion-pria", children: ["Kaos", "Kemeja", "Celana"] },
  { name: "Fashion Wanita", slug: "fashion-wanita", children: ["Dress", "Blouse", "Rok"] },
  { name: "Elektronik", slug: "elektronik", children: ["Audio", "Aksesoris HP", "Smartwatch"] },
  { name: "Rumah Tangga", slug: "rumah-tangga", children: ["Dapur", "Dekorasi"] },
  { name: "Kecantikan", slug: "kecantikan", children: ["Skincare", "Makeup"] },
] as const;

export const bankSeed = ["BCA", "BNI", "Mandiri", "BRI"] as const;
export const courierSeed = ["jne", "sicepat", "jnt"] as const;
export const cities = [
  { province: "DKI Jakarta", city: "Jakarta Selatan", district: "Kebayoran Baru", postalCode: "12120" },
  { province: "Jawa Barat", city: "Bandung", district: "Coblong", postalCode: "40132" },
  { province: "Jawa Timur", city: "Surabaya", district: "Gubeng", postalCode: "60281" },
  { province: "Banten", city: "Tangerang", district: "Cipondoh", postalCode: "15148" },
] as const;

// Password semua akun demo (HANYA untuk dev; seed diblokir di production).
export const SEED_PASSWORD = "Password123";
