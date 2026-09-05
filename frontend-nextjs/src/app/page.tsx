"use client";
import { useTheme } from "@/contexts/ThemeContext";
import ClassicHome from "@/components/ClassicHome";
import ClubHome from "@/components/ClubHome";
export default function Home() {
  const { design } = useTheme();
  return design === "classic" ? <ClassicHome /> : <ClubHome />;
}
