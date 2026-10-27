import { screen } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";

export async function chooseOption(label: string | RegExp, option: string | RegExp): Promise<void> {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  // Base UI opens on an animation frame, which may run after click() resolves.
  await userEvent.click(await screen.findByRole("option", { name: option }));
}
