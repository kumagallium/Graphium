import { HelloBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";

// ブロック登録エントリー
// SandboxEditor の blocks に渡す
export const helloBlock: CustomBlockEntry = {
  type: "hello",
  spec: HelloBlock,
};
