import type { VehicleType } from "../../src/generated/prisma/client.js";
import { prisma } from "../../src/lib/prisma.js";
import { setOutboundFetchForTests } from "../../src/lib/outbound.js";
import { dateOnly } from "../../src/utils/time.js";
import { fromNow, HOUR, verifiedUser } from "./activity-helpers.js";
import { api, bearer } from "./helpers.js";

let plate = 0;

export async function addVehicle(ownerId: string, type: VehicleType = "CAR", seatCapacity = type === "BIKE" ? 1 : 4) {
  plate += 1;
  const registrationNumber = `DHAKA METRO-GA 11-${String(1000 + plate)}`;
  return prisma.vehicle.create({
    data: {
      ownerId,
      type,
      brand: type === "BIKE" ? "Honda" : "Toyota",
      model: type === "BIKE" ? "CB Hornet" : "Axio",
      colour: "White",
      registrationNumber,
      registrationNumberNormalized: registrationNumber.replace(/[^A-Z0-9]/g, ""),
      photoKey: "vehicle-photos/test.jpg",
      seatCapacity,
      status: "APPROVED",
    },
  });
}

// A verified student who is an approved, Active rider with a valid licence and a car.
export async function activeRider(type: VehicleType = "CAR") {
  const user = await verifiedUser();
  await prisma.user.update({ where: { id: user.id }, data: { isVerifiedRider: true, riderActive: true } });
  await prisma.riderApplication.create({ data: { userId: user.id, status: "APPROVED", licenceExpiresOn: dateOnly("2031-01-01") } });
  const vehicle = await addVehicle(user.id, type);
  return { ...user, vehicle };
}

export const subArea = (name = `Area ${Math.random().toString(36).slice(2, 8)}`) => prisma.subArea.create({ data: { name } });

const campus = { address: "Campus gate", lat: 23.8103, lng: 90.4125 };
const farmgate = { address: "Farmgate", lat: 23.7576, lng: 90.3899 };

export function requestBody(subAreaId: string, overrides: Record<string, unknown> = {}) {
  return {
    pickup: campus,
    destination: farmgate,
    startTime: fromNow(3 * HOUR).toISOString(),
    offeredAmount: 150,
    passengerCount: 1,
    notes: "Near the library",
    subAreaId,
    ...overrides,
  };
}

export function offerBody(vehicleId: string, overrides: Record<string, unknown> = {}) {
  return {
    pickup: campus,
    destination: farmgate,
    departureTime: fromNow(3 * HOUR).toISOString(),
    farePerSeat: 80,
    vehicleId,
    seats: 3,
    ...overrides,
  };
}

export async function postRequest(token: string, body: Record<string, unknown>) {
  return api().post("/api/rides/requests").set(bearer(token)).send(body);
}

export async function postOffer(token: string, body: Record<string, unknown>) {
  return api().post("/api/rides/offers").set(bearer(token)).send(body);
}

export async function book(token: string, offerId: string, seats?: number) {
  return api().post(`/api/rides/offers/${offerId}/bookings`).set(bearer(token)).send(seats === undefined ? {} : { seats });
}

// The route server answers with this distance (metres), or fails.
export function fakeOsrm(metres: number | null) {
  setOutboundFetchForTests(async (url) => {
    if (!url.includes("/route/v1/driving/")) throw new Error(`unexpected ${url}`);
    if (metres === null) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ code: "Ok", routes: [{ distance: metres }] }) };
  });
}
