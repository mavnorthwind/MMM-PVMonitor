var foo = 0xF00;
var bar = "BAR";

var tbl = `
<table>
    <tr>
        <td>
        ${foo}
        <p/>
        ${bar}
        </td>
    </tr>
</table>
`;

console.log(tbl);