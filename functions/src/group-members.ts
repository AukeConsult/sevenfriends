import { getFirestore } from "firebase-admin/firestore";
import { groupDoc } from "./paths";

/**
 * The small fields of a group. Its picture is a data URL in the same document, so every read that does not need the picture asks for these only
 * (`getAll` with a field mask): the picture is not read with every message, list of members or change.
 */
export const GROUP_HEAD = ["name", "createdBy", "members", "memberOrder", "invitedBy"];

/** The head of a group (or only some of its fields); undefined when the group is gone. */
export async function groupHead(groupId: string, fields: string[] = GROUP_HEAD): Promise<FirebaseFirestore.DocumentData | undefined> {
  const [snap] = await getFirestore().getAll(groupDoc(groupId), { fieldMask: fields });
  return snap.data();
}

/** The other members of a group (everybody but me) with the circle each has it in; [] when the group is gone. */
export async function otherMembers(groupId: string, me: string): Promise<{ uid: string; circleId: string }[]> {
  const members = ((await groupHead(groupId, ["members"]))?.members ?? {}) as Record<string, string>;
  return Object.entries(members)
    .filter(([uid]) => uid !== me)
    .map(([uid, circleId]) => ({ uid, circleId }));
}
