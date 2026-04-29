import { createApp, watch } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import { GraffitiPlugin, useGraffiti, useGraffitiSession } from "@graffiti-garden/wrapper-vue";

function loadComponent(name) {
  return () => import(`./${name}/main.js`).then((m) => m.default());
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: loadComponent("home") },
    { path: "/profile", component: loadComponent("profile") },
    { path: "/chat/:chatId", component: loadComponent("chat"), props: true },
    // Route now expects chatId and messageId as direct segments
    { path: "/suggestion/:chatId/:messageId(.*)", component: loadComponent("suggestion"), props: true },
    { path: "/login", component: loadComponent("login") },
    { path: "/trash", component: loadComponent("trash") }
  ],
});

const App = {
  template: "#template",
  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();

    watch(session, (newSession) => {
      if (newSession === null) {
        router.push("/login");
      } else if (newSession && router.currentRoute.value.path === "/login") {
        router.push("/");
      }
    }, { immediate: true }); 

    async function logout() {
      if (session.value) {
        await graffiti.logout(session.value);
      }
    }

    return { session, logout };
  }
};

createApp(App)
  .use(router)
  .use(GraffitiPlugin, { graffiti: new GraffitiDecentralized() })
  .mount("#app");