// Adapted from postprocessing v6.38.0, zlib license.
// Function parameters generalized. Tetrahedral math unchanged.
export const tetrahedral = `vec4 tetra(sampler3D lut, vec3 rgb, float texel) {

		

			/* Strategy: Fetch the four corners (v1, v2, v3, v4) of the tetrahedron that corresponds to the input coordinates,
			calculate the barycentric weights and interpolate the nearest color samples. */

			vec3 p = floor(rgb);
			vec3 f = rgb - p;

			vec3 v1 = (p + 0.5) * texel;
			vec3 v4 = (p + 1.5) * texel;
			vec3 v2, v3; // Must be identified.
			vec3 frac;

			if(f.r >= f.g) {

				if(f.g > f.b) {

					// T4: R >= G > B
					frac = f.rgb;
					v2 = vec3(v4.x, v1.y, v1.z);
					v3 = vec3(v4.x, v4.y, v1.z);

				} else if(f.r >= f.b) {

					// T6: R >= B >= G
					frac = f.rbg;
					v2 = vec3(v4.x, v1.y, v1.z);
					v3 = vec3(v4.x, v1.y, v4.z);

				} else {

					// T2: B > R >= G
					frac = f.brg;
					v2 = vec3(v1.x, v1.y, v4.z);
					v3 = vec3(v4.x, v1.y, v4.z);

				}

			} else {

				if(f.b > f.g) {

					// T3: B > G > R
					frac = f.bgr;
					v2 = vec3(v1.x, v1.y, v4.z);
					v3 = vec3(v1.x, v4.y, v4.z);

				} else if(f.r >= f.b) {

					// T5: G > R >= B
					frac = f.grb;
					v2 = vec3(v1.x, v4.y, v1.z);
					v3 = vec3(v4.x, v4.y, v1.z);

				} else {

					// T1: G >= B > R
					frac = f.gbr;
					v2 = vec3(v1.x, v4.y, v1.z);
					v3 = vec3(v1.x, v4.y, v4.z);

				}

			}

			// Interpolate manually to avoid 8-bit quantization of fractions.
			vec4 n1 = texture(lut, v1);
			vec4 n2 = texture(lut, v2);
			vec4 n3 = texture(lut, v3);
			vec4 n4 = texture(lut, v4);

			vec4 weights = vec4(
				1.0 - frac.x,
				frac.x - frac.y,
				frac.y - frac.z,
				frac.z
			);

			// weights.x * n1 + weights.y * n2 + weights.z * n3 + weights.w * n4
			vec4 result = weights * mat4(
				vec4(n1.r, n2.r, n3.r, n4.r),
				vec4(n1.g, n2.g, n3.g, n4.g),
				vec4(n1.b, n2.b, n3.b, n4.b),
				vec4(1.0)
			);

			return vec4(result.rgb, 1.0);

}
`;
