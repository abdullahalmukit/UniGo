import { prisma } from "../src/lib/prisma.js";

async function seedSampleRequests() {
  console.log("Seeding sample open requests...");

  // 1. Sub-areas
  const subAreas = ["Dhanmondi", "Nilkhet", "TSC / University Campus", "Uttara", "Mirpur"];
  const areaMap = new Map<string, string>();
  for (const name of subAreas) {
    const area = await prisma.subArea.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
    });
    areaMap.set(name, area.id);
  }

  // 2. Demo users
  let a = await prisma.user.findUnique({ where: { email: "demo.chat.a@example.com" } });
  let b = await prisma.user.findUnique({ where: { email: "demo.chat.b@example.com" } });
  if (!a || !b) {
    const university = await prisma.university.findFirst({ where: { isActive: true }, orderBy: { name: "asc" } });
    if (!university) {
      console.error("No university found. Please run `npm run db:seed -w server` first.");
      return;
    }
    const { hashPassword } = await import("../src/modules/auth/password.js");
    const demoHash = await hashPassword("Demo1234");
    if (!a) {
      a = await prisma.user.create({
        data: {
          email: "demo.chat.a@example.com",
          phone: "+8801700000101",
          passwordHash: demoHash,
          universityId: university.id,
          role: "USER",
          isStudentVerified: true,
          profile: { create: { fullName: "Demo Student A" } },
        },
      });
    }
    if (!b) {
      b = await prisma.user.create({
        data: {
          email: "demo.chat.b@example.com",
          phone: "+8801700000102",
          passwordHash: demoHash,
          universityId: university.id,
          role: "USER",
          isStudentVerified: true,
          isRiderVerified: true,
          profile: { create: { fullName: "Demo Student B" } },
        },
      });
    }
  }

  const now = new Date();
  const laterToday = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 3. Open Ride Request (by Student A)
  const rideActivity = await prisma.activity.create({
    data: {
      type: "RIDE_REQUEST",
      status: "OPEN",
      creatorId: a.id,
      startTime: laterToday,
      blocksTime: true,
      rideRequest: {
        create: {
          pickupAddress: "Dhanmondi 27, Satmasjid Road, Dhaka",
          pickupLat: 23.7523,
          pickupLng: 90.3756,
          destinationAddress: "TSC, Dhaka University, Dhaka",
          destinationLat: 23.7317,
          destinationLng: 90.3957,
          offeredAmount: 120,
          passengerCount: 1,
          notes: "Need a ride to class, I will be waiting near the gate.",
          subAreaId: areaMap.get("Dhanmondi")!,
          routeDistanceKm: 4.5,
        },
      },
    },
  });
  console.log("Created open ride request:", rideActivity.id);

  // 4. Open Food Request (by Student B)
  const foodActivity = await prisma.activity.create({
    data: {
      type: "FOOD",
      status: "OPEN",
      creatorId: b.id,
      startTime: new Date(now.getTime() + 90 * 60 * 1000), // 1.5 hours from now
      blocksTime: true,
      foodRequest: {
        create: {
          restaurantName: "KFC Nilkhet",
          restaurantAddress: "Nilkhet Mor, Mirpur Road, Dhaka",
          restaurantLat: 23.7335,
          restaurantLng: 90.3855,
          items: "1x Zinger Burger, 1x Large Fries",
          details: "Please bring from the counter and keep it warm.",
          quantity: 2,
          estimatedBudget: 350,
          pickupAddress: "KFC Nilkhet, Dhaka",
          pickupLat: 23.7335,
          pickupLng: 90.3855,
          deliveryAddress: "Dr. Muhammad Shahidullah Hall, Dhaka",
          deliveryLat: 23.7251,
          deliveryLng: 90.4012,
          deliveryServiceAmount: 30,
          subAreaId: areaMap.get("Nilkhet")!,
        },
      },
    },
  });
  console.log("Created open food request:", foodActivity.id);

  // 5. Open Uni Service Request (by Student A)
  const shoppingCategory = await prisma.serviceCategory.findUnique({
    where: { code: "SHOPPING_PURCHASING" },
  });

  if (shoppingCategory) {
    const serviceActivity = await prisma.activity.create({
      data: {
        type: "SERVICE",
        status: "OPEN",
        creatorId: a.id,
        startTime: new Date(now.getTime() + 3 * 60 * 60 * 1000), // 3 hours from now
        blocksTime: true,
        serviceRequest: {
          create: {
            categoryId: shoppingCategory.id,
            serviceTitle: "Grocery & Stationery Run",
            taskTitle: "Buy notebook and ball pens from Nilkhet",
            description: "Need 2 Khata (spiral notebooks) and 5 black ballpoint pens for tomorrow's exam.",
            destinationAddress: "Surja Sen Hall, Dhaka University",
            destinationLat: 23.7325,
            destinationLng: 90.3892,
            preferredDate: now,
            hasPreferredTime: true,
            offeredAmount: 80,
            estimatedBudget: 250,
            itemDetails: "2x Spiral notebook, 5x Matador Orbit pens",
            quantity: 7,
            pickupAddress: "Nilkhet Book Market, Dhaka",
            pickupLat: 23.7330,
            pickupLng: 90.3860,
            subAreaId: areaMap.get("Nilkhet")!,
            instructions: "Please make sure notebooks are unruled/plain.",
          },
        },
      },
    });
    console.log("Created open service request:", serviceActivity.id);
  }

  // 6. Content (B8): Spotlight, Promos, Banners
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const existingSpotlight = await prisma.spotlightItem.findFirst();
  if (!existingSpotlight) {
    await prisma.spotlightItem.create({
      data: {
        title: "Welcome to UniGo Campus",
        mediaType: "IMAGE",
        mediaUrl: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800&auto=format&fit=crop&q=80",
        linkUrl: "https://unigo.app",
        linkLabel: "Learn More",
        startsAt: now,
        expiresAt: nextMonth,
        sortOrder: 0,
        isActive: true,
      },
    });
    console.log("Seeded sample Spotlight item.");
  }

  const existingPromo = await prisma.promo.findFirst();
  if (!existingPromo) {
    await prisma.promo.create({
      data: {
        title: "৳50 Off First Ride",
        description: "Enjoy ৳50 discount on your first campus ride with student verification.",
        imageUrl: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=800&auto=format&fit=crop&q=80",
        promoCode: "UNIGO50",
        startsAt: now,
        endsAt: nextMonth,
        isActive: true,
      },
    });
    console.log("Seeded sample Promo.");
  }

  const existingBanner = await prisma.banner.findFirst();
  if (!existingBanner) {
    await prisma.banner.create({
      data: {
        title: "Campus Rides & Fast Food Delivery by Students",
        imageUrl: "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=800&auto=format&fit=crop&q=80",
        linkUrl: "/services",
        startsAt: now,
        endsAt: nextMonth,
        sortOrder: 0,
        isActive: true,
      },
    });
    console.log("Seeded sample Banner.");
  }

  console.log("Sample requests seeded successfully!");
}

seedSampleRequests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error seeding sample requests:", err);
    process.exit(1);
  });

