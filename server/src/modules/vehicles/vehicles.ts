import sharp from "sharp";
import { rules } from "../../config/rules.js";
import type { VehicleType } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { maskRegistrationNumber } from "../../utils/registration-number.js";

const { maxSidePx, jpegQuality } = rules.rider.vehiclePhoto;

// A vehicle photo as a JPEG at most maxSidePx on its longest side. Re-encoding
// proves it is an image and drops EXIF data (B1 rules), since students see it later.
export async function processVehiclePhoto(input: Uint8Array) {
  try {
    return await sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize(maxSidePx, maxSidePx, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new AppError(415, "IMAGE_UNREADABLE", "A vehicle photo could not be read. Try another photo");
  }
}

type VehicleFields = {
  id: string;
  type: VehicleType;
  brand: string;
  model: string;
  colour: string;
  registrationNumber: string;
  seatCapacity: number;
};

// What students see about a rider's vehicle (proposal section 6): never the
// full registration number. Every response to students must use this (B3 on).
export function toPublicVehicle(vehicle: VehicleFields) {
  return {
    id: vehicle.id,
    type: vehicle.type,
    brand: vehicle.brand,
    model: vehicle.model,
    colour: vehicle.colour,
    seatCapacity: vehicle.seatCapacity,
    registrationNumber: maskRegistrationNumber(vehicle.registrationNumber),
  };
}

// Passenger seats allowed for a vehicle type (rider not counted).
export function seatLimits(type: VehicleType) {
  return type === "BIKE" ? rules.seats.bike : rules.seats.car;
}
