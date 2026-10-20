import { ImageResponse } from "next/og";
import { BrandMark } from "@/lib/brand-mark";

export function GET() {
  return new ImageResponse(<BrandMark size={512} safe />, { width: 512, height: 512 });
}
