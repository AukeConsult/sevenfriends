import { groupDoc } from "./paths";

/** The other members of a group (everybody but me) with the circle each has it in; [] when the group is gone. */
export async function otherMembers(groupId: string, me: string): Promise<{ uid: string; circleId: string }[]> {
  const members = ((await groupDoc(groupId).get()).data()?.members ?? {}) as Record<string, string>;
  return Object.entries(members)
    .filter(([uid]) => uid !== me)
    .map(([uid, circleId]) => ({ uid, circleId }));
}
