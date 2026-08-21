import { createBrowserRouter, Navigate } from "react-router-dom";
import { Root } from "../routes/Root";
import { IndexRedirect } from "../routes/IndexRedirect";
import { ChatRoute } from "../routes/ChatRoute";
import { SignInRoute } from "../routes/SignInRoute";

export const router = createBrowserRouter([
  { path: "/signin", element: <SignInRoute /> },
  {
    path: "/",
    element: <Root />,
    children: [
      { index: true, element: <IndexRedirect /> },
      { path: "chats/:id", element: <ChatRoute /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
