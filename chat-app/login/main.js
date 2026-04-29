import { useGraffiti, useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { useRouter } from "vue-router";

export default async () => ({
  template: await fetch(new URL("./index.html", import.meta.url))
    .then((r) => r.text())
    .then((html) => html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")),

  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter();

    async function login() {
      try {
        await graffiti.login();
        // Redirect to the home workspace after successful authentication
        router.push("/"); 
      } catch (error) {
        console.error("Login failed:", error);
      }
    }

    async function logout() {
      if (session.value) {
        try {
          await graffiti.logout(session.value);
        } catch (error) {
          console.error("Logout failed:", error);
        }
      }
      // Redirect to login page explicitly
      router.push("/login"); 
    }

    return { 
      session, 
      login, 
      logout 
    };
  }
});