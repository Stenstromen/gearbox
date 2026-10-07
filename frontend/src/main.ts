import "./style.css";
import {mountApp} from "./components/app";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
    throw new Error("missing #app");
}
mountApp(root);
