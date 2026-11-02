"use client";

import { use } from "react";
import { MomentDetail } from "@/components/moments/MomentDetail";

export default function MomentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <MomentDetail id={id} />;
}
