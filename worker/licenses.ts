// ---------------------------------------------------------------------------
// GitLike — License Templates
// Available licenses for new repositories. NOL is the default.
// ---------------------------------------------------------------------------

/** License identifier used in API requests. */
export type LicenseId = 'NOL' | 'MIT' | 'Apache-2.0' | 'GPL-3.0' | 'BSD-2-Clause' | 'none';

/** Display label + full text for each license. */
export type LicenseTemplate = {
  id: LicenseId;
  name: string;
  text: string;
};

/** All available license options (order = UI display order). */
export const LICENSE_OPTIONS: LicenseId[] = [
  'NOL',
  'MIT',
  'Apache-2.0',
  'GPL-3.0',
  'BSD-2-Clause',
  'none',
];

/** Map of license display names for the frontend. */
export const LICENSE_NAMES: Record<LicenseId, string> = {
  NOL: 'Nuclear Option License v1.0 (NOL)',
  MIT: 'MIT License',
  'Apache-2.0': 'Apache License 2.0',
  'GPL-3.0': 'GNU GPL v3.0',
  'BSD-2-Clause': 'BSD 2-Clause',
  none: 'No License',
};

/** Get the full license text. Returns null for 'none'. */
export function getLicenseText(id: LicenseId, year?: number, holder?: string): string | null {
  if (id === 'none') return null;
  const y = year ?? new Date().getFullYear();
  const h = holder ?? '[copyright holder]';
  switch (id) {
    case 'NOL':
      return NOL_TEXT;
    case 'MIT':
      return MIT_TEXT.replace('{year}', String(y)).replace('{holder}', h);
    case 'Apache-2.0':
      return APACHE_TEXT;
    case 'GPL-3.0':
      return GPL3_HEADER.replace('{year}', String(y)).replace('{holder}', h);
    case 'BSD-2-Clause':
      return BSD2_TEXT.replace('{year}', String(y)).replace('{holder}', h);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// License texts
// ---------------------------------------------------------------------------

const NOL_TEXT = `Nuclear Option License (NOL) v1.0

Copyright (c) 2026 Quilibrium, Inc.

TERMS AND CONDITIONS

0. Definitions

  "Software" means the source code, object code, documentation, and any
  associated files distributed under this License.

  "You" means the individual or Organization exercising rights under this
  License.

  "Organization" means any entity that is not a natural person acting solely
  in their individual capacity. This includes, without limitation:
  corporations, limited liability companies, partnerships, sole
  proprietorships (when operating as a business entity), non-profit
  organizations, governmental bodies, academic institutions, foundations,
  cooperatives, and any other form of legal entity or unincorporated
  association.

  "Affiliates" means, with respect to an Organization, any entity that
  directly or indirectly controls, is controlled by, or is under common
  control with that Organization. "Control" means (a) ownership of fifty
  percent (50%) or more of the outstanding voting securities or equivalent
  voting interest of an entity, or (b) the power to direct or cause the
  direction of the management and policies of an entity, whether through
  ownership, contract, or otherwise (effective operational control).

  "Source Code" means the preferred form of a work for making modifications
  to it, including all associated build scripts, interface definition files,
  and configuration files necessary to compile, link, and run the work.

  "All Source Code" means every line of source code, in any programming
  language, that is owned by, licensed to, or otherwise controlled by the
  Organization and its Affiliates, regardless of whether such code interacts
  with, derives from, links to, or has any technical relationship whatsoever
  to this Software.

  "Use" means any exercise of rights in the Software, including but not
  limited to: copying, modifying, distributing, compiling, linking,
  executing, deploying, offering as a service, incorporating into another
  work, and Training Use.

  "Training Use" means using the Software, any output of the Software, any
  model weights produced by the Software, or any data derived from the
  Software as training data, fine-tuning data, reinforcement learning data,
  evaluation data, benchmark data, or input to any machine learning or
  artificial intelligence system.

  "Covered Work" means the Software, any modified version of the Software,
  or any work that incorporates, links to, or is derived from the Software.

1. Grant of Rights to Individuals

  Subject to the terms of this License, each contributor hereby grants to You
  (when You are a natural person acting solely in Your individual capacity
  and not on behalf of any Organization) a perpetual, worldwide,
  non-exclusive, royalty-free license to Use, copy, modify, and distribute
  the Software and any Covered Work, provided that:

  (a) You include a copy of this License with any distribution of the
      Software or Covered Work.

  (b) You provide prominent notice of any modifications You make.

  (c) You license any Covered Work You distribute under this same License.

  (d) If You make a modified version of the Software available to users over
      a computer network (including but not limited to web applications,
      APIs, cloud services, and software-as-a-service), You must make the
      complete Source Code of the modified version available to those users
      under this License, at no charge, through a standard means of software
      distribution. This obligation applies regardless of whether the
      modified version is formally "distributed."

2. Grant of Rights to Organizations -- Total Copyleft

  Subject to the terms of this License, each contributor hereby grants to You
  (when You are an Organization, or a natural person acting on behalf of an
  Organization) a perpetual, worldwide, non-exclusive, royalty-free license
  to Use, copy, modify, and distribute the Software and any Covered Work,
  provided that all of the following conditions are met:

  (a) You comply with all obligations set forth in Section 1(a) through
      1(d) above.

  (b) TOTAL SOURCE CODE RELEASE: Upon any Use of the Software by the
      Organization or any of its Affiliates, the Organization and all of its
      Affiliates must release All Source Code under this License (the Nuclear
      Option License v1.0). This obligation:

      (i)   applies to All Source Code, not merely to code that is derived
            from, linked to, or interacts with the Software;

      (ii)  extends to the entire corporate family, including all Affiliates
            as defined in Section 0;

      (iii) must be fulfilled within thirty (30) calendar days of the
            Organization's first Use of the Software;

      (iv)  requires that All Source Code be made publicly available through
            a standard means of software distribution (such as a publicly
            accessible version control repository) at no charge; and

      (v)   is an ongoing obligation: any new source code created or
            acquired by the Organization or its Affiliates after the initial
            release must also be released under this License within thirty
            (30) calendar days of its creation or acquisition.

  (c) TRAINING USE: The obligations in Section 2(b) apply with equal force
      to Training Use. If any Organization or its Affiliates engage in
      Training Use of the Software, this triggers the total source code
      release obligation for the Organization and all Affiliates.

3. No Sublicensing Escape

  (a) No Organization may sublicense the Software or any Covered Work under
      any license other than this License. Any attempt to sublicense under
      different terms is void and does not relieve the Organization of its
      obligations under Section 2.

  (b) No Organization may use dual licensing, contractual arrangements,
      intermediary entities, licensing pools, or any other mechanism to
      circumvent, limit, or avoid the total copyleft obligations set forth
      in Section 2.

  (c) If an Organization receives the Software or a Covered Work through a
      permissive sublicense or alternative license purportedly granted by a
      third party, such alternative license is void with respect to the
      Organization, and the Organization's Use remains subject to all terms
      of this License.

4. Network Copyleft

  If You run a modified version of the Software on a server or other system
  and allow users to interact with it remotely (whether through a network
  protocol, API, web interface, or any other means of remote interaction),
  You must offer those users the opportunity to receive the complete Source
  Code of the modified version, under this License, at no charge, through a
  standard means of software distribution. This obligation applies to all
  users who interact with the modified version, regardless of whether they
  receive a copy of the Software.

5. Termination

  (a) Your rights under this License terminate automatically if You fail to
      comply with any of its terms.

  (b) Upon termination, You must immediately cease all Use of the Software
      and destroy all copies in Your possession or control.

  (c) Rights may be reinstated only by coming into full compliance with all
      terms of this License, including, for Organizations, the complete
      release of All Source Code as required by Section 2(b). Reinstatement
      is not automatic and requires affirmative demonstration of compliance.

6. Disclaimer of Warranty

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL
  THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING
  FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  DEALINGS IN THE SOFTWARE.

7. Limitation of Liability

  IN NO EVENT SHALL ANY CONTRIBUTOR BE LIABLE TO YOU FOR ANY DIRECT, INDIRECT,
  INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING BUT NOT
  LIMITED TO PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES, LOSS OF USE, DATA,
  OR PROFITS, OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
  LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
  NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THE SOFTWARE,
  EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

8. Miscellaneous

  (a) If any provision of this License is held to be unenforceable, the
      remaining provisions shall remain in full force and effect, and the
      unenforceable provision shall be reformed to the minimum extent
      necessary to make it enforceable while preserving its intent.

  (b) This License constitutes the entire agreement between the parties with
      respect to the Software and supersedes all prior or contemporaneous
      understandings regarding such subject matter.

  (c) This License shall be governed by and construed in accordance with the
      laws of the jurisdiction in which the principal copyright holder
      resides, without regard to its conflict of laws principles.

  (d) Nothing in this License shall be construed to grant any rights to use
      the trademarks, service marks, or trade names of any contributor,
      except as required for reasonable and customary use in describing the
      origin of the Software.

END OF LICENSE
`;

const MIT_TEXT = `MIT License

Copyright (c) {year} {holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const APACHE_TEXT = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work.

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to the Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by the Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding any notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
`;

const GPL3_HEADER = `GNU GENERAL PUBLIC LICENSE
Version 3, 29 June 2007

Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Copyright (c) {year} {holder}

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
`;

const BSD2_TEXT = `BSD 2-Clause License

Copyright (c) {year}, {holder}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`;
