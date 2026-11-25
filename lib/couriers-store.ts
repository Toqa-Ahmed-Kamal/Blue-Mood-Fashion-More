// Server-only storage for the shipping companies table (same Upstash Redis, no TTL — kept until deleted).
//
// Keys (prefix bm:{prod|preview|dev}:v1:)
//   couriers:companies  HASH  companyId → JSON CourierCompany (name, optional phone and note, own scooter or not)
// Orders keep the company's name in their own shipment box, so deleting a company here leaves the orders as they are.
import { keyPrefix, redisPipeline } from "./redis.ts";
import type { CourierCompany } from "./shipment.ts";

const COMPANIES = () => `${keyPrefix()}couriers:companies`;

export async function loadCourierCompanies(): Promise<CourierCompany[]> {
  const [flat] = await redisPipeline([["HGETALL", COMPANIES()]], "read", 5000);
  const list = Array.isArray(flat) ? flat : [];
  const values: CourierCompany[] = [];
  for (let index = 1; index < list.length; index += 2) {
    try {
      values.push(JSON.parse(String(list[index])) as CourierCompany);
    } catch {
      // Skip a corrupt entry instead of failing the whole list.
    }
  }
  return values.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Adds or replaces a company, and reads it back before reporting success. */
export async function saveCourierCompany(company: CourierCompany) {
  const [, stored] = await redisPipeline([["HSET", COMPANIES(), company.id, JSON.stringify(company)], ["HGET", COMPANIES(), company.id]], "write");
  return typeof stored === "string" ? (JSON.parse(stored) as CourierCompany) : null;
}

export async function deleteCourierCompany(id: string) {
  const [removed] = await redisPipeline([["HDEL", COMPANIES(), id]], "write");
  return Number(removed) === 1;
}
