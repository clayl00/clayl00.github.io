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

    // 1. The button click ONLY triggers the popup. No routing here!
    function login() {
      graffiti.toggleLogIn(); 
    }

    function logout() {
      if (session.value) {
        graffiti.toggleLogIn();
      }
    }

    // 2. Watch the session. When it becomes active, THEN route to home.
    watch(session, (newSession) => {
      if (newSession) {
        router.push("/");
      }
    }, { immediate: true }); // immediate: true checks if they are already logged in when the page loads

    return { 
      session, 
      login, 
      logout 
    };
  }
});