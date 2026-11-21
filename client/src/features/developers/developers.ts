import alif160 from "../../assets/developers/alif-160.webp";
import alif320 from "../../assets/developers/alif-320.webp";
import mukit160 from "../../assets/developers/mukit-160.webp";
import mukit320 from "../../assets/developers/mukit-320.webp";
import shawon160 from "../../assets/developers/shawon-160.webp";
import shawon320 from "../../assets/developers/shawon-320.webp";

// The people who build UniGo (Meet the Developers page and footer). Photos
// are the developers' own, re-saved as small square WebP files without
// metadata. Mukit is the project owner (CLAUDE.md section 0).

export type Developer = {
  id: "mukit" | "shawon" | "alif";
  name: string;
  // Key under developers.roles in bn.json / en.json
  role: "owner" | "developer";
  email: string;
  github: string;
  portfolio?: string;
  photo: { small: string; large: string };
};

export const DEVELOPERS: readonly Developer[] = [
  {
    id: "mukit",
    name: "Md. Abdul Mukit",
    role: "owner",
    email: "abdullahalmukit287@gmail.com",
    github: "https://github.com/abdullahalmukit",
    portfolio: "https://mukit.swe.bd/",
    photo: { small: mukit160, large: mukit320 },
  },
  {
    id: "shawon",
    name: "Shawon Sarkar",
    role: "developer",
    email: "avisarkar014@gmail.com",
    github: "https://github.com/Shawon014000",
    photo: { small: shawon160, large: shawon320 },
  },
  {
    id: "alif",
    name: "Mohammad Alif",
    role: "developer",
    email: "mohammadalif8786@gmail.com",
    github: "https://github.com/MohammadAlif0",
    photo: { small: alif160, large: alif320 },
  },
];

// The GitHub user name from a profile link ("github.com/abdullahalmukit" -> "abdullahalmukit").
export const githubHandle = (url: string) => url.replace(/\/+$/, "").split("/").pop() ?? url;
// The host of a portfolio link, without "https://" and a trailing slash.
export const siteLabel = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
