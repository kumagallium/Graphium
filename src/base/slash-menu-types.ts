export type SlashMenuItem = {
  title: string;
  subtext?: string;
  group: string;
  aliases?: string[];
  onItemClick: (editor: any) => void;
};
