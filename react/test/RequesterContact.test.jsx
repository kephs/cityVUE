import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import RequesterContact from "../src/staff/requests/RequesterContact.jsx";

test.each([
  { name: null, email: null },
  { name: "Fictional 山", email: null },
  { name: null, email: "fictional@example.com" },
  {
    name: "<script>fictional</script>",
    email: '<img src=x onerror="fictional">',
  },
])(
  "F039 authorized partial, empty and markup-like values stay plain text: %j",
  (data) => {
    const { container } = render(
      <RequesterContact canRead state={{ data }} onLoad={vi.fn()} />,
    );
    expect(
      screen.getByRole("heading", { name: "Requester Contact" }),
    ).toBeInTheDocument();
    for (const value of Object.values(data).filter(Boolean))
      expect(screen.getByText(value)).toBeInTheDocument();
    if (!data.name && !data.email)
      expect(
        screen.getByText("No contact information was provided."),
      ).toBeInTheDocument();
    if (!data.name) expect(screen.queryByText("Name")).not.toBeInTheDocument();
    if (!data.email)
      expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(container.querySelectorAll("script,img,a")).toHaveLength(0);
  },
);

test("F039 denied capability cannot render even an accidentally retained payload", () => {
  render(
    <RequesterContact
      canRead={false}
      state={{ data: { name: "Alex Example", email: "alex@example.com" } }}
    />,
  );
  expect(screen.getByText("Protected")).toBeInTheDocument();
  expect(screen.queryByText("Alex Example")).not.toBeInTheDocument();
  expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
});
