import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        netflix: {
          red: "#e50914",
          black: "#141414",
          dark: "#181818",
        },
      },
      fontFamily: {
        sans: ["system-ui", "sans-serif"],
        display: ["var(--font-netflix)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "hero-gradient":
          "linear-gradient(to top, rgba(20,20,20,1) 0%, rgba(20,20,20,0.6) 40%, transparent 70%)",
      },
    },
  },
  plugins: [],
};
export default config;
