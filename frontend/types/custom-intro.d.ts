declare module "virtual:custom-intro" {
  import type { CustomIntro } from "@/lib/customIntro";

  const customIntro: CustomIntro | null;
  export default customIntro;
}
