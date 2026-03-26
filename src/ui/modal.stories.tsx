// Modal Atom — モーダルシェルのカタログ

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "./modal";
import { Button } from "./button";

const meta: Meta<typeof Modal> = {
  title: "Atoms/Modal",
  component: Modal,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof Modal>;

export const Basic: Story = {
  name: "基本",
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>モーダルを開く</Button>
        <Modal open={open} onClose={() => setOpen(false)}>
          <ModalHeader onClose={() => setOpen(false)}>設定</ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground">モーダルの内容がここに入ります。</p>
            <p className="text-xs text-muted-foreground mt-2">
              Escape キーまたはオーバーレイクリックで閉じます。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
            <Button onClick={() => setOpen(false)}>保存</Button>
          </ModalFooter>
        </Modal>
      </>
    );
  },
};

export const WithForm: Story = {
  name: "フォーム付き",
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>フォームモーダル</Button>
        <Modal open={open} onClose={() => setOpen(false)}>
          <ModalHeader onClose={() => setOpen(false)}>新規作成</ModalHeader>
          <ModalBody className="space-y-4 min-w-[400px]">
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1">タイトル</label>
              <input
                type="text"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="実験名を入力..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1">説明</label>
              <textarea
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px]"
                placeholder="概要を入力..."
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
            <Button onClick={() => setOpen(false)}>作成</Button>
          </ModalFooter>
        </Modal>
      </>
    );
  },
};

export const Compact: Story = {
  name: "確認ダイアログ",
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>削除</Button>
        <Modal open={open} onClose={() => setOpen(false)}>
          <ModalBody className="max-w-[340px] pt-6">
            <h3 className="text-sm font-semibold text-foreground mb-2">本当に削除しますか？</h3>
            <p className="text-xs text-muted-foreground">この操作は取り消せません。</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>キャンセル</Button>
            <Button variant="destructive" size="sm" onClick={() => setOpen(false)}>削除する</Button>
          </ModalFooter>
        </Modal>
      </>
    );
  },
};
