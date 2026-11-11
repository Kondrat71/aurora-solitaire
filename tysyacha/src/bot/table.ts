import { Resvg } from '@resvg/resvg-js';
import { GrammyError, InputFile, type Api, type InlineKeyboard } from 'grammy';
import type { PrivateView } from '../game/engine.ts';
import { renderTableSvg } from '../render/svg.ts';

export async function publishPhotoTable(
  api: Api,
  chatId: number,
  messageId: number | undefined,
  view: PrivateView,
  seat: number,
  caption: string,
  keyboard: InlineKeyboard,
): Promise<number> {
  const svg = renderTableSvg(view, seat);
  const png = new Resvg(svg, { font: { defaultFontFamily: 'DejaVu Sans' } }).render().asPng();
  const photo = new InputFile(png, 'tysyacha.png');
  const options = { caption, parse_mode: 'HTML' as const };
  if (messageId !== undefined) {
    try {
      await api.editMessageMedia(chatId, messageId, { type: 'photo', media: photo, ...options }, { reply_markup: keyboard });
      return messageId;
    } catch (error) {
      if (!(error instanceof GrammyError) || error.error_code !== 400) throw error;
      if (error.description.includes('message is not modified')) return messageId;
    }
  }
  const sent = await api.sendPhoto(chatId, photo, { ...options, reply_markup: keyboard });
  if (messageId !== undefined) await api.editMessageReplyMarkup(chatId, messageId).catch(() => undefined);
  return sent.message_id;
}
