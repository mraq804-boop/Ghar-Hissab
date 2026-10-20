import { ImageResponse } from "next/og";
import { BrandMark } from "@/lib/brand-mark";

export function GET() {
  return new ImageResponse(<BrandMark size={192} rounded={false} />, { width: 192, height: 192 });
}
