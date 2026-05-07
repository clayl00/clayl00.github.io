import { watch } from "vue";
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
        // Use the correct method exposed by the wrapper
        await graffiti.login(); 
      } catch (error) {
        // Fails silently if the user closes the popup
        console.error("Login cancelled or failed:", error);
      }
    }

    async function logout() {
      if (session.value) {
        try {
          await graffiti.logout();
        } catch (error) {
          console.error("Logout failed:", error);
        }
      }
    }

    // Safely watch the session. When it becomes active, THEN route to home.
    watch(session, (newSession) => {
      if (newSession) {
        router.push("/");
      }
    }, { immediate: true }); 

    return { 
      session, 
      login, 
      logout 
    };
  }
});