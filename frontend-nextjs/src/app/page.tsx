"use client";
import { useTheme } from "@/contexts/ThemeContext";
import ClassicHome from "@/components/ClassicHome";
import ClubHome from "@/components/ClubHome";
import dynamic from "next/dynamic";
const CinematicHome = dynamic(() => import("@/components/cinematic/CinematicHome"), { ssr: false });
export default function Home() {
  const { design } = useTheme();
  return design === "classic" ? <ClassicHome /> : design === "cinematic" ? <CinematicHome /> : <ClubHome />;
}
