"use client";
import { useTheme } from "@/contexts/ThemeContext";
import BoomerHome from "@/components/boomer/BoomerHome";
import ClubHome from "@/components/ClubHome";
import dynamic from "next/dynamic";
const CinematicHome = dynamic(() => import("@/components/cinematic/CinematicHome"), { ssr: false });
export default function Home() {
  const { design } = useTheme();
  return design === "boomer" ? <BoomerHome /> : design === "cinematic" ? <CinematicHome /> : <ClubHome />;
}
